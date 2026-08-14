/** Stable same-origin endpoint shared by the Node plugin and its bundled Web client. */
export const WEB_DRAFT_ENDPOINT = '/vision-bridge/v1/web-drafts'

/** Read-only, per-send route decision endpoint. It never admits a prompt or stores image bytes. */
export const WEB_IMAGE_ROUTE_ENDPOINT = '/vision-bridge/v1/web-image-route'

/** Session-authorized bridge image reader used by the native history gallery. */
export const WEB_ATTACHMENT_ENDPOINT = '/vision-bridge/v1/web-attachment'
