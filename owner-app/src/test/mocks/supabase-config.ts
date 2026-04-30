const createChain = () => ({
  select: () => createChain(),
  eq: () => createChain(),
  maybeSingle: async () => ({ data: null, error: null }),
  single: async () => ({ data: null, error: null }),
  upsert: async () => ({ data: null, error: null }),
});

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: null } }),
    refreshSession: async () => ({ data: { session: null } }),
    getUser: async () => ({ data: { user: null } }),
  },
  functions: {
    invoke: async () => ({ data: null, error: null }),
  },
  from: () => createChain(),
  channel: () => ({
    on: () => ({
      subscribe: () => ({ unsubscribe: () => undefined }),
    }),
    subscribe: () => ({ unsubscribe: () => undefined }),
  }),
  removeChannel: () => undefined,
};
