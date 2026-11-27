import { createWeatherHandler } from '../server/weather.js';

const handler = createWeatherHandler();
export default function weather(req, res) {
  return handler(req, res);
}
