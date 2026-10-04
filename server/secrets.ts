// API keys live in the OS credential store (macOS Keychain, libsecret, Windows Credential Manager),
// not in `data/`: lesson and tutor runs have file tools and work inside `data/workspaces`.

export type SecretStore = {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
};

function secretStore(name: string): SecretStore {
  const id = { service: "clayfold", name };
  let cached: string | null | undefined;
  return {
    async get() {
      cached ??= await Bun.secrets.get(id);
      return cached;
    },
    async set(value) {
      await Bun.secrets.set({ ...id, value });
      cached = value;
    },
    async delete() {
      await Bun.secrets.delete(id);
      cached = null;
    },
  };
}

export const elevenLabsKey = secretStore("elevenlabs-api-key");

/** Optional: with it, source_discover also searches the web through Exa. */
export const exaKey = secretStore("exa-api-key");
