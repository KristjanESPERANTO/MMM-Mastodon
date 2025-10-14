/* global Module */

Module.register("MMM-Mastodon", {
  defaults: {
    instanceUrl: "",
    accessToken: "",
    feedType: "home", // home | hashtag | profile
    hashtag: "opensource",
    profileAcct: "",
    limit: 10,
    updateInterval: 300000,
    showMedia: true,
    dateFormat: "relative", // relative | absolute
    hideReplies: true,
    showQrCode: true,
    qrCodeSize: 128,
    maxLinkLength: 30,
    rotatePosts: true,
    rotationInterval: 15000
  },

  start() {
    this.items = [];
    this.error = null;
    this.loaded = false;
    this.updateTimer = null;
    this.rotationTimer = null;
    this.currentIndex = 0;

    if (!this.config.instanceUrl || !this.config.accessToken) {
      this.error = "Missing instanceUrl or accessToken.";
      this.updateDom();
      return;
    }

    this.sendSocketNotification("MASTODON_CONFIG", this.config);
    this.scheduleUpdate(0);
  },

  getStyles() {
    return ["MMM-Mastodon.css"];
  },

  scheduleUpdate(delay) {
    const nextLoad =
      typeof delay === "number" ? delay : this.config.updateInterval;
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(
      () => {
        this.sendSocketNotification("MASTODON_REQUEST", {
          feedType: this.config.feedType,
          limit: this.config.limit,
          hashtag: this.config.hashtag,
          profileAcct: this.config.profileAcct
        });
      },
      Math.max(nextLoad, 0)
    );
  },

  suspend() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
  },

  resume() {
    if (!this.config.instanceUrl || !this.config.accessToken) {
      return;
    }
    this.scheduleUpdate(0);
    this.setupRotation();
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MASTODON_RESPONSE") {
      const { items, error } = payload;
      this.error = error || null;
      this.items = Array.isArray(items) ? items : [];
      this.loaded = true;

      if (!this.items.length) {
        this.currentIndex = 0;
      } else if (this.currentIndex >= this.items.length) {
        this.currentIndex = 0;
      }

      this.updateDom();
      this.setupRotation();
      this.scheduleUpdate();
    }
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-mastodon";

    if (!this.loaded) {
      wrapper.innerHTML = "Loading...";
      return wrapper;
    }

    if (this.error) {
      const errorEl = document.createElement("div");
      errorEl.className = "error";
      errorEl.innerHTML = this.error;
      wrapper.appendChild(errorEl);
      return wrapper;
    }

    if (!this.items.length) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "empty";
      emptyEl.innerHTML = "No posts.";
      wrapper.appendChild(emptyEl);
      return wrapper;
    }

    const itemsToRender = this.config.rotatePosts
      ? [this.items[this.currentIndex] ?? this.items[0]]
      : this.items;

    itemsToRender.forEach((item) => {
      wrapper.appendChild(this.renderItem(item));
    });

    return wrapper;
  },

  renderItem(item) {
    const { account, createdAt, content, media, boostedBy } = item;
    const itemEl = document.createElement("div");
    itemEl.className = "feed-item";

    if (boostedBy) {
      const boostLine = document.createElement("div");
      boostLine.className = "boost-line";
      boostLine.innerHTML = `Boosted by @${boostedBy.acct}`;
      itemEl.appendChild(boostLine);
    }

    const header = document.createElement("div");
    header.className = "account-line";

    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = account.avatar;
    avatar.alt = account.displayName || account.username;
    header.appendChild(avatar);

    const nameColumn = document.createElement("div");

    const displayName = document.createElement("div");
    displayName.className = "display-name";
    displayName.innerHTML = account.displayName || account.username;
    nameColumn.appendChild(displayName);

    const acct = document.createElement("div");
    acct.className = "acct";
    acct.innerHTML = `@${account.acct}`;
    nameColumn.appendChild(acct);

    header.appendChild(nameColumn);

    const timestamp = document.createElement("div");
    timestamp.className = "timestamp";
    timestamp.innerHTML = this.formatTimestamp(createdAt);
    header.appendChild(timestamp);

    itemEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "item-body";

    const mainColumn = document.createElement("div");
    mainColumn.className = "body-main";

    const contentEl = document.createElement("div");
    contentEl.className = "content";
    // Mastodon already delivers sanitized HTML snippets; render directly for rich text.
    contentEl.innerHTML = content;
    this.truncateLinkText(contentEl);
    mainColumn.appendChild(contentEl);

    if (this.config.showMedia && Array.isArray(media) && media.length) {
      mainColumn.appendChild(this.renderMedia(media));
    }

    body.appendChild(mainColumn);

    if (this.config.showQrCode && item.qrCode) {
      body.appendChild(this.renderQrCode(item.qrCode));
    }

    itemEl.appendChild(body);

    return itemEl;
  },

  setupRotation() {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }

    if (!this.config.rotatePosts) {
      return;
    }

    const interval = Number.parseInt(this.config.rotationInterval, 10);
    if (!Number.isFinite(interval) || interval <= 0) {
      return;
    }

    if (!Array.isArray(this.items) || this.items.length <= 1) {
      return;
    }

    this.rotationTimer = setTimeout(() => {
      this.advanceRotation();
    }, interval);
  },

  advanceRotation() {
    if (
      !this.config.rotatePosts ||
      !Array.isArray(this.items) ||
      this.items.length <= 1
    ) {
      this.rotationTimer = null;
      return;
    }

    const interval = Number.parseInt(this.config.rotationInterval, 10);
    if (!Number.isFinite(interval) || interval <= 0) {
      this.rotationTimer = null;
      return;
    }

    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    this.updateDom();
    this.rotationTimer = setTimeout(() => {
      this.advanceRotation();
    }, interval);
  },

  renderQrCode(dataUrl) {
    const qrWrapper = document.createElement("div");
    qrWrapper.className = "qr-wrapper";

    const qrImg = document.createElement("img");
    qrImg.className = "qr-code";
    qrImg.src = dataUrl;
    qrImg.alt = "QR code for post";

    const qrSize = Math.min(
      512,
      Math.max(64, Number.parseInt(this.config.qrCodeSize, 10) || 128)
    );
    qrImg.style.setProperty("width", `${qrSize}px`);
    qrImg.style.setProperty("height", `${qrSize}px`);

    qrWrapper.appendChild(qrImg);
    return qrWrapper;
  },

  truncateLinkText(container) {
    const option = this.config.maxLinkLength;

    if (option === false) {
      return;
    }

    const limit = Number.parseInt(option, 10);
    if (!Number.isFinite(limit) || limit < 0) {
      return;
    }

    container.querySelectorAll("a").forEach((anchor) => {
      const original = anchor.textContent || "";
      const trimmed = original.trim();
      anchor.removeAttribute("aria-label");

      if (limit > 0 && trimmed.length <= limit) {
        anchor.textContent = original;
        if (original) {
          anchor.title = original;
        } else {
          anchor.removeAttribute("title");
        }
        return;
      }

      if (limit === 0) {
        anchor.textContent = "";
        anchor.title = original;
        anchor.setAttribute("aria-label", original);
        return;
      }

      const headLength = Math.max(5, Math.floor(limit * 0.65));
      const tailLength = Math.max(3, limit - headLength - 1);
      const truncated = `${trimmed.slice(0, headLength)}…${trimmed.slice(-tailLength)}`;
      anchor.textContent = truncated;
      anchor.title = original;
      anchor.removeAttribute("aria-label");
    });
  },

  renderMedia(media) {
    const grid = document.createElement("div");
    grid.className = "media-grid";

    media.forEach((item) => {
      if (item.type === "image") {
        const img = document.createElement("img");
        img.src = item.previewUrl || item.url;
        img.alt = item.description || "";
        grid.appendChild(img);
      }
    });

    return grid;
  },

  formatTimestamp(dateString) {
    const date = new Date(dateString);
    if (this.config.dateFormat === "absolute") {
      return date.toLocaleString();
    }

    const diffMs = Date.now() - date.getTime();
    const diffSeconds = Math.max(1, Math.floor(diffMs / 1000));
    const units = [
      { max: 60, divisor: 1, label: "s" },
      { max: 3600, divisor: 60, label: "m" },
      { max: 86400, divisor: 3600, label: "h" },
      { max: 604800, divisor: 86400, label: "d" }
    ];

    for (const unit of units) {
      if (diffSeconds < unit.max) {
        const value = Math.floor(diffSeconds / unit.divisor);
        return `${value}${unit.label}`;
      }
    }

    return date.toLocaleDateString();
  }
});
