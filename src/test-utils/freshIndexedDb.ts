import { IDBFactory } from "fake-indexeddb";

/** Gives the test a brand-new, empty IndexedDB. The mirror module keys its cached
 *  connection on the factory object, so a new factory also forgets the old connection. */
export function installFreshIndexedDb(): void {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
}
