export function getAdminHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('admin_token');
  return token ? { 'x-admin-secret': token } : {};
}
