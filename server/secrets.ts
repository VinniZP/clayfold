// API keys live in the OS credential store (macOS Keychain, libsecret, Windows Credential Manager),
// not in `data/`: lesson and tutor runs have file tools and work inside `data/workspaces`.

export type SecretStore = {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
};

const ELEVENLABS = { service: "clayfold", name: "elevenlabs-api-key" };

let cached: string | null | undefined;

export const elevenLabsKey: SecretStore = {
  async get() {
    cached ??= await Bun.secrets.get(ELEVENLABS);
    return cached;
  },
  async set(value) {
    await Bun.secrets.set({ ...ELEVENLABS, value });
    cached = value;
  },
  async delete() {
    await Bun.secrets.delete(ELEVENLABS);
    cached = null;
  },
};
