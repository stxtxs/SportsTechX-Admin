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
	legacy: 'Carried over from the old Hub',
	revoked: 'Revoked by an admin',
	unknown: 'Trial or admin grant (before 24 Nov)',
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
	financial_services: 'Financial services', family_investment_office: 'Family office', sovereign_wealth_fund: 'Sovereign wealth fund',
});
export const companyStatusLabel = lookup({ active: 'Active', dead: 'Closed', acquired: 'Acquired', not_sportstech: 'Not sports tech', ipo: 'Public (IPO)' });
export const businessModelLabel = lookup({ b2b: 'B2B', b2c: 'B2C', b2b2c: 'B2B2C', d2c: 'D2C', b2g: 'B2G', other: 'Other' });

/** Funding rounds and M&A. */
export const dealStatusLabel = lookup({ active: 'Active', inactive: 'Inactive', not_sportstech: 'Not sports tech', website_error: 'Website broken' });
export const dealSizeLabel = lookup({ under_1m: 'Under $1M', from_1m_to_10m: '$1M–10M', from_10m_to_100m: '$10M–100M', over_100m: 'Over $100M' });
export const acquisitionTypeLabel = lookup({ acquisition: 'Acquisition', merger: 'Merger', asset_purchase: 'Asset purchase' });

/** What a data change request is about (data_change_requests.entity_type). */
export const requestEntityLabel = lookup({
	company: 'Company', deal: 'Deal', investor: 'Investor', investor_fund: 'Investor fund',
	investor_portfolio: 'Investor portfolio', ecosystem: 'Ecosystem',
});

/** Review queues (startups to add, investor review) and their Apollo/Attio enrichment. */
export const pipelineStatusLabel = lookup({ new: 'New', reviewing: 'Reviewing', added: 'Added', rejected: 'Rejected' });
export const enrichmentStatusLabel = lookup({ pending: 'Waiting', enriching: 'Enriching…', enriched: 'Enriched', failed: 'Failed' });

/** Deal Flow (scout_deals) and the interest requests on it. */
export const scoutDealStatusLabel = lookup({
	draft: 'Draft', pending: 'Waiting for review', reviewing: 'In review', live: 'Live', changes_requested: 'Changes requested', closed: 'Closed',
});
export const scoutInterestStatusLabel = lookup({
	received: 'Received', source_confirmed: 'Source confirmed', shared: 'Shared', connected: 'Connected', declined: 'Declined',
});

/** Other queues. */
export const introStatusLabel = lookup({ requested: 'Waiting', sent: 'Introduced', declined: 'Declined' });
export const refundStatusLabel = lookup({ pending: 'Waiting', refunded: 'Refunded', rejected: 'Rejected', failed: 'Failed' });
export const jobStatusLabel = lookup({ pending: 'Waiting', running: 'Running', completed: 'Done', failed: 'Failed', stuck: 'Stuck' });

/** Email outbox. */
export const emailStatusLabel = lookup({ pending: 'Waiting to send', sending: 'Sending', sent: 'Sent', failed: 'Failed', stuck: 'Stuck' });
export const emailDeliveryLabel = lookup({ delivered: 'Delivered', bounced: 'Bounced', complained: 'Marked as spam', delayed: 'Delayed', rejected: 'Rejected' });
export const emailProviderLabel = lookup({ ses: 'Amazon SES', resend: 'Resend' });

/** AI usage ledger providers. */
export const aiProviderLabel = lookup({ anthropic: 'Anthropic', voyage: 'Voyage AI', openai: 'OpenAI' });

/** Stripe payment outcomes. */
export const stripePaymentLabel = lookup({ succeeded: 'Paid', refunded: 'Refunded', failed: 'Failed', uncaptured: 'Authorised, not captured', blocked: 'Blocked' });

/** Credits ledger. */
export const creditTxnLabel = lookup({
	grant: 'Monthly allowance', monthly_grant: 'Monthly allowance', topup: 'Top-up purchase', purchase: 'Top-up purchase', topup_purchase: 'Top-up purchase',
	spend: 'Used', debit: 'Used', refund: 'Refunded', admin_grant: 'Granted by an admin', signup: 'Signup bonus', expire: 'Expired', expiry: 'Expired',
	adjustment: 'Adjustment', reset: 'Reset',
});
/** Spend category of a ledger row. 'stx' rows are wallet movements with no category (grants, monthly grants, expiries). */
export const creditPoolLabel = lookup({ ai: 'AI', integration: 'Export', stx: 'Wallet' });

/** User roles. */
export const roleLabel = lookup({ user: 'User', admin: 'Admin' });
