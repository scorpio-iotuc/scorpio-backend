export type SignupMode = 'public' | 'admin';

export const getSignupMode = (): SignupMode =>
  process.env.SIGNUP_MODE === 'public' ? 'public' : 'admin';

export const isPublicSignupEnabled = (): boolean => getSignupMode() === 'public';

export const getTrustProxyHops = (): number => {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 3);
  return Number.isInteger(hops) && hops >= 0 ? hops : 3;
};
