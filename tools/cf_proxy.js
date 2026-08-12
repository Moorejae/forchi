export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = "api.telegram.org";
    return fetch(new Request(url, request));
  }
};
