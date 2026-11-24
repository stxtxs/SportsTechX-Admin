/**
 * Plain words for the values the database stores — so admins never read raw enums
 * (`explore`, `venture_capital`, `past_due`, `claim_type`…). Unknown values fall back to a
 * tidied version of themselves ("some_value" → "Some value").
 */
export const tidy = (v: string | null | undefined): string =>
	v ? v.replace(/[_-]+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()) : '—';

const lookup = (map: Record<string, string>) => (v: string | null | undefined): string => (v ? map[v] ?? tidy(v) : '—');

/** Plans. */
export const tierLabel = lookup({ explore: 'Explore (free)', raise: 'Raise', scout: 'Scout', admin: 'Admin' });

/** Why a user has their plan (profiles.access_source). */
export const accessSourceLabel = lookup({
	stripe: 'Paid via Stripe',
	admin_grant: 'Admin grant (time-limited)',
	claim_trial: 'Claim reward trial (30 days)',
	playmakers: 'Playmakers member',
	admin_tier: 'Set by an admin (permanent)',
	signup: 'Free signup',
	legacy: 'Migrated from the old Hub',
});

/** Stripe subscription status. */
export const stripeStatusLabel = lookup({
	active: 'Active', trialing: 'Free trial', past_due: 'Payment overdue', unpaid: 'Unpaid',
	canceled: 'Cancelled', incomplete: 'Payment not completed', incomplete_expired: 'Payment expired', paused: 'Paused',
});

/** Claims. */
export const claimTypeLabel = lookup({ company: 'Company', investor: 'Investor', ecosystem_entity: 'Ecosystem entry' });
export const claimStatusLabel = lookup({ pending: 'Waiting', picked_up: 'Picked up', verified: 'Verified', rejected: 'Rejected' });
/** "Actively raising" for a company, "actively investing" for an investor. */
export const activeFlagLabel = (claimType: string | null | undefined) => (claimType === 'investor' ? 'Actively investing' : 'Actively raising');

/** Data change requests. */
export const requestStatusLabel = lookup({ open: 'Waiting', picked_up: 'Picked up', resolved: 'Done', rejected: 'Rejected' });

/** Catalog. */
export const entityTypeLabel = lookup({ program: 'Program', event: 'Event', initiative: 'Initiative', organization: 'Organization' });
export const investorCategoryLabel = lookup({
	venture_capital: 'Venture capital', private_equity: 'Private equity', corporate_venture_capital: 'Corporate VC', angel: 'Angel',
	angel_network: 'Angel network', accelerator: 'Accelerator', family_office: 'Family office', fund_of_funds: 'Fund of funds',
	sports_team: 'Sports team / club', athlete: 'Athlete', other: 'Other',
});
export const companyStatusLabel = lookup({ active: 'Active', dead: 'Closed', acquired: 'Acquired', not_sportstech: 'Not sports tech', ipo: 'Public (IPO)' });

/** Credits ledger. */
export const creditTxnLabel = lookup({
	grant: 'Monthly allowance', monthly_grant: 'Monthly allowance', topup: 'Top-up purchase', purchase: 'Top-up purchase',
	spend: 'Used', debit: 'Used', refund: 'Refunded', admin_grant: 'Granted by an admin', signup: 'Signup bonus', expire: 'Expired', reset: 'Reset',
});

/** User roles. */
export const roleLabel = lookup({ user: 'User', admin: 'Admin' });
