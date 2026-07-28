// Shared-device registration (`architecture.md §4.2`, "Device classification").
//
// An admin performs this once, ON the device being registered: the response sets
// a long-lived marker cookie on that browser, and every session opened there
// afterwards gets the shared lifetime policy (30 min idle, 12 h absolute cap)
// instead of the personal one.
//
// The enumerated set is the shared one — tablet and desktop, fixed at two — so
// anything unregistered is personal. That direction is chosen in §4.2 because the
// unenumerated set becomes the default, and the small set is the safe default to
// have to name.

import type { DeviceSummary, RegisterDeviceRequest } from '../../../shared/src/index.js';
import { setDeviceCookie } from '../middleware/cookies.js';
import { listDevices, registerDevice } from '../services/session.js';
import { body, defineRoute, requiredString } from './registry.js';

export const deviceRoutes = [
  defineRoute({
    method: 'get',
    path: '/devices',
    access: { tier: 'ADMIN' },
    handler: async (_req, res) => {
      const devices = await listDevices();
      const payload: DeviceSummary[] = devices.map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: d.createdAt.toISOString(),
      }));
      res.json(payload);
    },
  }),

  defineRoute({
    method: 'post',
    path: '/devices',
    access: { tier: 'ADMIN' },
    handler: async (req, res) => {
      const input = body(req) as unknown as RegisterDeviceRequest;
      const label = requiredString({ label: input.label }, 'label');
      const device = await registerDevice(label.trim());

      setDeviceCookie(res, device.id);

      const payload: DeviceSummary = {
        id: device.id,
        label: device.label,
        createdAt: device.createdAt.toISOString(),
      };
      res.status(201).json(payload);
    },
  }),
];
