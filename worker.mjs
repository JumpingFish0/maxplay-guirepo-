import { handleRequest } from "./addon.mjs";

export default {
  async fetch(request) {
    return handleRequest(request);
  }
};
