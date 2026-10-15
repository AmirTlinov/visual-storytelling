/** Test transport only: forwards a request to the existing measurement owner. */
export async function benchmarkRequest(endpoint, body) {
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-benchmark-token': endpoint.token },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? `Benchmark transport: ${response.status}`);
  return result;
}
