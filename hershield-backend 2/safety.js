'use strict';
const MINUTE = 60000;
function stageAt(expectedArrivalAt, now = Date.now()) {
  const overdue = Number(now) - Number(new Date(expectedArrivalAt));
  return overdue >= 30 * MINUTE ? 5 : overdue >= 10 * MINUTE ? 4 : overdue >= 5 * MINUTE ? 3 : overdue >= 0 ? 2 : 1;
}
function locationInput(value) {
  if (!value || typeof value.lat !== 'number' || typeof value.lng !== 'number' ||
      !Number.isFinite(value.lat) || !Number.isFinite(value.lng) ||
      Math.abs(value.lat) > 90 || Math.abs(value.lng) > 180) {
    throw Object.assign(new Error('location requires numeric lat (-90..90) and lng (-180..180)'), { status: 400 });
  }
  if (value.accuracy !== undefined && (!Number.isFinite(value.accuracy) || value.accuracy < 0)) {
    throw Object.assign(new Error('accuracy must be a nonnegative number'), { status: 400 });
  }
  return { lat: value.lat, lng: value.lng, accuracy: value.accuracy, receivedAt: new Date() };
}
function mapsLink(location) {
  return location ? `https://maps.google.com/?q=${location.lat},${location.lng}` : null;
}
function phoneInput(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('phone must be a string'), { status: 400 });
  const phone = value.replace(/[ +()-]/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(phone)) throw Object.assign(new Error('Use an Indian mobile number with 10 digits or +91'), { status: 400 });
  return phone;
}
module.exports = { stageAt, locationInput, mapsLink, phoneInput };
