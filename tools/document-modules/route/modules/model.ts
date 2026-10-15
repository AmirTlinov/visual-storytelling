import { dependencyRouteModel } from '@visual-storytelling/core/recipes';
export const graph = {
  origin: 'maker',
  destination: 'home',
  nodes: [
    { id: 'maker', label: 'Фабрика' },
    { id: 'warehouse', label: 'Склад' },
    { id: 'home', label: 'Дом' },
  ],
  edges: [
    { id: 'store', from: 'maker', to: 'warehouse' },
    { id: 'deliver', from: 'warehouse', to: 'home' },
    { id: 'direct', from: 'maker', to: 'home', reserve: 'independent' as const },
  ],
};
export default dependencyRouteModel(graph);
