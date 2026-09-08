const NodeHelper = require("node_helper");
const QRCode = require("qrcode");

const fetch = globalThis.fetch;

module.exports = NodeHelper.create({
  start() {
    this.configs = new Map();
    this.profileCache = new Map();
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MASTODON_CONFIG") {
      if (payload?.instanceId && payload.config) {
        this.configs.set(payload.instanceId, payload.config);
      }
      return;
    }

    if (notification === "MASTODON_REQUEST") {
      const instanceId = payload?.instanceId;
      const config = instanceId ? this.configs.get(instanceId) : null;
      if (!config) {
        this.sendError(instanceId, "Module is not configured yet.");
        return;
      }

      this.handleRequest(instanceId, config, payload).catch((error) => {
        this.sendError(instanceId, error.message || "Unknown error.");
      });
    }
  },

  async handleRequest(instanceId, config, requestConfig) {
    const merged = { ...config, ...requestConfig };

    try {
      this.validateConfig(merged);
      const items = await this.fetchFeed(merged);
      this.sendSocketNotification("MASTODON_RESPONSE", {
        instanceId,
        items
      });
    } catch (error) {
      this.sendError(instanceId, error.message || "Failed to load feed.");
    }
  },

  validateConfig(config) {
    if (!config.instanceUrl) {
      throw new Error("Missing instanceUrl.");
    }

    if (!config.accessToken) {
      throw new Error("Missing accessToken.");
    }

    if (config.feedType === "hashtag" && !config.hashtag) {
      throw new Error("Hashtag feed requires a hashtag.");
    }

    if (config.feedType === "profile" && !config.profileAcct) {
      throw new Error("Profile feed requires a profileAcct.");
    }
  },

  async fetchFeed(config) {
    switch (config.feedType) {
      case "home":
        return await this.fetchTimeline("/api/v1/timelines/home", config);
      case "hashtag": {
        const tag = encodeURIComponent(
          config.hashtag.toLowerCase().replace(/^#/, "")
        );
        return await this.fetchTimeline(`/api/v1/timelines/tag/${tag}`, config);
      }
      case "profile": {
        const accountId = await this.lookupAccount(
          config.instanceUrl,
          config.accessToken,
          config.profileAcct
        );
        return await this.fetchTimeline(
          `/api/v1/accounts/${accountId}/statuses`,
          config
        );
      }
      default:
        throw new Error(`Unsupported feed type: ${config.feedType}`);
    }
  },

  async lookupAccount(instanceUrl, accessToken, acct) {
    const normalizedAcct = acct.trim().toLowerCase();
    if (this.profileCache.has(normalizedAcct)) {
      return this.profileCache.get(normalizedAcct);
    }

    const url = new URL("/api/v1/accounts/lookup", instanceUrl);
    url.searchParams.set("acct", normalizedAcct);

    const response = await fetch(url, {
      headers: this.buildHeaders(accessToken)
    });

    if (!response.ok) {
      throw new Error(`Lookup failed (${response.status}).`);
    }

    const data = await response.json();
    if (!data || !data.id) {
      throw new Error("Lookup returned no account id.");
    }

    this.profileCache.set(normalizedAcct, data.id);
    return data.id;
  },

  async fetchTimeline(path, config) {
    const requestedLimit = Math.max(1, Number.parseInt(config.limit, 10) || 10);
    const fetchLimit = config.hideReplies
      ? Math.min(40, requestedLimit * 3)
      : requestedLimit;

    const url = new URL(path, config.instanceUrl);
    url.searchParams.set("limit", String(fetchLimit));
    url.searchParams.set("exclude_reblogs", "false");

    const response = await fetch(url, {
      headers: this.buildHeaders(config.accessToken)
    });

    if (response.status === 401) {
      throw new Error("Unauthorized: check access token scopes.");
    }

    if (response.status === 429) {
      throw new Error("Rate limit reached: please increase updateInterval.");
    }

    if (!response.ok) {
      throw new Error(`Mastodon API error (${response.status}).`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("Unexpected response shape.");
    }

    const filtered = config.hideReplies
      ? data.filter((status) => {
          const base = status.reblog || status;
          return (
            base.in_reply_to_id === null && base.in_reply_to_account_id === null
          );
        })
      : data;

    const limited = filtered.slice(0, requestedLimit);
    const normalized = await Promise.all(
      limited.map((status) => this.normalizeStatus(status, config))
    );
    return normalized;
  },

  async normalizeStatus(status, config) {
    const base = status.reblog || status;
    const booster = status.reblog ? status.account : null;
    let qrCode = null;

    if (config.showQrCode && base.url) {
      const size = Math.min(
        512,
        Math.max(64, Number.parseInt(config.qrCodeSize, 10) || 128)
      );
      try {
        qrCode = await QRCode.toDataURL(base.url, {
          margin: 1,
          width: size,
          errorCorrectionLevel: "M"
        });
      } catch {
        // Keep feed usable even if QR generation fails.
        qrCode = null;
      }
    }

    return {
      id: base.id,
      createdAt: base.created_at,
      content: base.content,
      url: base.url,
      account: {
        id: base.account.id,
        username: base.account.username,
        displayName: base.account.display_name,
        acct: base.account.acct,
        avatar: base.account.avatar_static || base.account.avatar
      },
      boostedBy: booster
        ? {
            id: booster.id,
            username: booster.username,
            displayName: booster.display_name,
            acct: booster.acct
          }
        : null,
      media: Array.isArray(base.media_attachments)
        ? base.media_attachments.map((attachment) => ({
            id: attachment.id,
            type: attachment.type,
            url: attachment.url,
            previewUrl: attachment.preview_url,
            description: attachment.description
          }))
        : [],
      qrCode
    };
  },

  buildHeaders(accessToken) {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    };
  },

  sendError(instanceId, message) {
    this.sendSocketNotification("MASTODON_RESPONSE", {
      instanceId,
      items: [],
      error: message
    });
  }
});
