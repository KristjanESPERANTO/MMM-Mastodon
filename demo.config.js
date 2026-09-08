const config = {
  address: "0.0.0.0",
  ipWhitelist: [],
  logLevel: ["INFO", "LOG", "WARN", "ERROR", "DEBUG"],
  modules: [
    {
      module: "clock",
      position: "top_left"
    },
    {
      module: "MMM-Mastodon",
      position: "top_right",
      header: "Mastodon",
      config: {
        instanceUrl:
          process.env.MASTODON_INSTANCE_URL || "https://mastodon.social",
        accessToken: process.env.MASTODON_ACCESS_TOKEN || "",
        feedType: "hashtag",
        hashtag: "opensource",
        limit: 5,
        updateInterval: 300000,
        showMedia: true,
        showQrCode: true,
        rotatePosts: true
      }
    }
  ]
};

/** ************* DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") {
  module.exports = config;
}
