// S1.8 Admin — metrics, accounts, donors, trucks, categories, category matching.
//
// Two exports, and the second is not a screen: `/metrics` was S3.2's own route
// until D18 folded it into this one's tab row, and `MetricsRedirect` is what keeps
// an existing bookmark resolving instead of 404ing.

export { AdminScreen } from './AdminScreen.tsx';
export { MetricsRedirect } from './MetricsRedirect.tsx';
