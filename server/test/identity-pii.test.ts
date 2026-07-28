// `shapeUser` — the sole exit path for an `app_user` record (`architecture.md §4.3`).
//
// A pure unit test on purpose: this is the one rule whose failure mode is silent.
// A missed case does not throw, it just publishes a volunteer's phone number.

import { describe, expect, it } from 'vitest';
import { shapeUser, type UserRecord, type Viewer } from '../src/pii.js';

const subject: UserRecord = {
  id: 'subject-id',
  username: 'nan',
  first_name: 'Nan',
  last_name: 'Ette',
  tier: 'VOLUNTEER',
  phone: '5551234567',
  address: '12 Elm St',
  deactivated_at: null,
};

const self: Viewer = { id: 'subject-id', tier: 'VOLUNTEER' };
const otherVolunteer: Viewer = { id: 'other-id', tier: 'VOLUNTEER' };
const staff: Viewer = { id: 'staff-id', tier: 'STAFF' };
const admin: Viewer = { id: 'admin-id', tier: 'ADMIN' };

describe('shapeUser', () => {
  it('never gates the name', () => {
    for (const viewer of [null, self, otherVolunteer, staff, admin]) {
      const shaped = shapeUser(subject, [], viewer);
      expect(shaped.firstName).toBe('Nan');
      expect(shaped.lastName).toBe('Ette');
      expect(shaped.username).toBe('nan');
    }
  });

  it('shows a volunteer their own phone and address', () => {
    const shaped = shapeUser(subject, ['DRIVE'], self);
    expect(shaped.phone).toBe('5551234567');
    expect(shaped.address).toBe('12 Elm St');
  });

  it('removes the fields entirely for another volunteer', () => {
    const shaped = shapeUser(subject, [], otherVolunteer);
    // Removed, not nulled: `null` is a real state (no phone on file), and §4.2
    // falls back to a random PIN because of it.
    expect('phone' in shaped).toBe(false);
    expect('address' in shaped).toBe(false);
  });

  it('removes the fields for an anonymous viewer', () => {
    const shaped = shapeUser(subject, [], null);
    expect('phone' in shaped).toBe(false);
  });

  it('shows them to Staff and, hierarchically, to Admin (I1)', () => {
    for (const viewer of [staff, admin]) {
      const shaped = shapeUser(subject, [], viewer);
      expect(shaped.phone, viewer.tier).toBe('5551234567');
      expect(shaped.address, viewer.tier).toBe('12 Elm St');
    }
  });

  it('keeps "hidden" distinguishable from "not on file"', () => {
    const noPhone = shapeUser({ ...subject, phone: null }, [], staff);
    expect('phone' in noPhone).toBe(true);
    expect(noPhone.phone).toBeNull();
  });

  it('carries the duty set through untouched (I2)', () => {
    expect(shapeUser(subject, ['DRIVE', 'REPORT'], self).duties).toEqual(['DRIVE', 'REPORT']);
    expect(shapeUser(subject, [], self).duties).toEqual([]);
  });

  it('reports a deactivated account as inactive rather than hiding it (I21)', () => {
    const shaped = shapeUser({ ...subject, deactivated_at: new Date() }, [], admin);
    expect(shaped.active).toBe(false);
    expect(shapeUser(subject, [], admin).active).toBe(true);
  });
});
