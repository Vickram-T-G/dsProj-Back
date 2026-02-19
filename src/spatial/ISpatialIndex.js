export default class ISpatialIndex {
  rebuild(entities) {
    throw new Error('Not implemented');
  }

  insert(entity) {
    throw new Error('Not implemented');
  }

  remove(entity) {
    throw new Error('Not implemented');
  }

  update(entity) {
    throw new Error('Not implemented');
  }

  queryRange(aabb) {
    throw new Error('Not implemented');
  }

  clear() {
    throw new Error('Not implemented');
  }

  debugDraw(ctx, camera) {}
}
