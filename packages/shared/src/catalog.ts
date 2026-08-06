/**
 * What changed about the notebooks themselves, as opposed to what any one run is doing.
 *
 * The run stream answers "is this busy". This answers "is what you are looking at still
 * true" — a notebook was saved, deployed, taken out of production, or removed. Both travel
 * on the same watch channel because they are the same subscription in practice: a screen
 * showing a list of notebooks wants both, and two sockets to say two things about the same
 * workspace is one socket too many.
 *
 * Like `RunActivityEvent` this carries identity and nothing else. Sending the changed
 * notebook itself would be faster by one request and would also mean the watch channel —
 * which is not scoped to anything the client asked for — starts carrying documents. The
 * client is told *that* something moved and fetches what it is allowed to fetch.
 */

export type CatalogChange = "saved" | "deployed" | "undeployed" | "deleted";

export interface CatalogChangedEvent {
  type: "catalog:changed";
  change: CatalogChange;
  notebookId: string;
}
