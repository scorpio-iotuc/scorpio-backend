const { isMainThread } = require('node:worker_threads');
module.exports = task => {
  if (task.fail) throw new Error('Task failed');
  return { value: task.value, isMainThread };
};
