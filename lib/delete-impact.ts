import { api } from '@/lib/api';

interface ImpactItem { label: string; count: number }
interface Impact { blocked: string[]; deletes: ImpactItem[]; unlinks: ImpactItem[] }
type Ask = (arg: { title?: string; message: string; confirmLabel?: string; danger?: boolean } | string) => Promise<boolean>;

const list = (xs: ImpactItem[]) => xs.map((x) => `${x.count} ${x.label}`).join(', ');

/**
 * Delete confirmation that says what the delete would actually do (server reads the
 * database's foreign-key rules), and stops early when the server would refuse it.
 * kind: company | investor | ecosystem | report | sectors | sports | tech-tags | round-types | countries
 */
export async function confirmDelete(ask: Ask, kind: string, id: string, name: string): Promise<boolean> {
	let i: Impact | null = null;
	try { i = await api<Impact>('GET', `/api/admin/delete-impact/${kind}/${id}`); } catch { /* fall back to a plain confirm */ }
	const effects = [
		i?.deletes.length ? `Also deletes: ${list(i.deletes)}.` : '',
		i?.unlinks.length ? `Loses the link (the records stay): ${list(i.unlinks)}.` : '',
	].filter(Boolean).join(' ');
	if (i?.blocked.length) {
		await ask({ title: `Can't delete ${name} yet`, message: [...i.blocked, effects].filter(Boolean).join(' '), confirmLabel: 'OK' });
		return false;
	}
	return ask({ title: `Delete ${name}?`, message: `This cannot be undone. ${effects}`.trim(), confirmLabel: 'Delete', danger: true });
}
