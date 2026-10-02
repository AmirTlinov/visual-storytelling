export const neuron = { id: 'neuron', label: 'Нейрон' };
export function compute({ a, b, threshold }) {
  const terms = [a * 3, b * 4],
    sum = terms[0] + terms[1];
  return { terms, sum, output: Number(sum >= threshold) };
}
