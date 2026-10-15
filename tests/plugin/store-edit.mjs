/** Storage-only fixture. Production authoring validates its prepared runtime before committing. */
export async function commitStoreEdit(store, request) {
  return store.commitPreparedEdit(await store.stageEdit(request));
}
