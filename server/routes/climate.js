import { Router } from 'express';
import { check } from '../validate.js';
import { searchPlaces, estimateClimate } from '../services/climate.js';

const SEARCH = { q: { type: 'string!', maxLength: 100 } };
const POINT = {
  latitude: { type: 'number!', min: -90, max: 90 },
  longitude: { type: 'number!', min: -180, max: 180 },
};

export function climateRouter(ctx) {
  const r = Router();
  r.get('/search', async (req, res) => {
    const { q } = check(SEARCH, { q: req.query.q });
    res.json(await searchPlaces(ctx, q));
  });
  r.get('/estimate', async (req, res) => {
    const point = check(POINT, { latitude: req.query.latitude, longitude: req.query.longitude });
    res.json(await estimateClimate(ctx, point));
  });
  return r;
}
