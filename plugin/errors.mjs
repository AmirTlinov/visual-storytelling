export function failure(code, message, detail = {}) {
  return Object.assign(new Error(message), { code, ...detail });
}
export function errorData(error) {
  return {
    code: error.code ?? 'operation_failed',
    message: error.message,
    ...(error.field ? { field: error.field } : {}),
    ...(error.current ? { current: error.current } : {}),
    ...(error.action ? { action: error.action } : {}),
  };
}
