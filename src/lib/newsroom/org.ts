/**
 * Organization store.
 * Public org info (name/slug), independent of auth state.
 */

import { writable } from 'svelte/store';
import type { OrganizationInfo } from './types';

export const orgStore = writable<OrganizationInfo | null>(null);
