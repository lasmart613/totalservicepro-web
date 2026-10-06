type SessionClient = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token?: string } | null } }>;
  };
};

/** Best-effort: remember a custom brand for future dropdowns. Never renames a row. */
export async function rememberManufacturerName(client: SessionClient, name: string): Promise<void> {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === 'Other') return;
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    await fetch('/api/catalog/manufacturers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: trimmed }),
    });
  } catch {
    /* optional catalog */
  }
}
