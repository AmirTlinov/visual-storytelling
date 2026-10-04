/** Cancellation belongs to the CLI boundary; workers receive one AbortSignal. */
export async function cancellableCommand(label, run) {
  const controller = new AbortController();
  let exitCode;
  const cancel = (code) => {
    exitCode = code;
    controller.abort(new Error(`${label} cancelled`));
  };
  const interrupt = () => cancel(130),
    terminate = () => cancel(143);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    await run(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    console.error(controller.signal.reason.message);
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    if (exitCode !== undefined) process.exitCode = exitCode;
  }
}
