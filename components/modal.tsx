'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Shared modal dialog. Fixes the previous per-page inline overlays whose
 * `display:grid; place-items:center` trapped overflow (tall modals couldn't be
 * scrolled vertically). Here the overlay itself scrolls AND the body scrolls
 * internally, so a modal taller than the viewport is always fully reachable.
 *
 * - Click the backdrop or press Esc to close.
 * - Locks body scroll while open.
 * - Header is fixed; `children` render in a scrollable body. Put the action
 *   buttons last inside `children` (or pass `footer` for a pinned footer).
 */
// Open modals, oldest first. Modals open on top of each other (e.g. "Create company"
// from inside the deal form), so only the top one may react to Esc — a window listener
// per modal used to close the whole stack and lose the outer form.
const openModals: object[] = [];

export function Modal({
	title,
	onClose,
	width = 560,
	children,
	footer,
}: {
	title: string;
	onClose: () => void;
	width?: number;
	children: React.ReactNode;
	footer?: React.ReactNode;
}) {
	// Registered once per mount (not per onClose identity), so a re-rendering parent
	// never jumps above the modal it opened.
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	useEffect(() => {
		const me = {};
		openModals.push(me);
		document.body.style.overflow = 'hidden';
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !e.defaultPrevented && openModals[openModals.length - 1] === me) closeRef.current();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			openModals.splice(openModals.indexOf(me), 1);
			if (openModals.length === 0) document.body.style.overflow = '';
			window.removeEventListener('keydown', onKey);
		};
	}, []);

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="modal-card card" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
				<div className="modal-head">
					<div className="modal-title">{title}</div>
					<button className="btn ghost" onClick={onClose} aria-label="Close"><X size={14} /></button>
				</div>
				<div className="modal-body">{children}</div>
				{footer && <div className="modal-foot">{footer}</div>}
			</div>
		</div>
	);
}
