const { BTE_PROJECTION } = require("bte-projection");

const sample = {
  lat: 40.74843814459844,
  lon: -73.98566440289457
};

const expected = {
  x: -8525873.069135161,
  y: -6026164.9710848285
};

const projected = BTE_PROJECTION.fromGeo(sample);
const roundTrip = BTE_PROJECTION.toGeo(projected);
const epsilon = 1e-6;

function assertClose(name, actual, target) {
  if (Math.abs(actual - target) > epsilon) {
    throw new Error(`${name} mismatch: got ${actual}, expected ${target}`);
  }
}

assertClose("x", projected.x, expected.x);
assertClose("y", projected.y, expected.y);
assertClose("lat", roundTrip.lat, sample.lat);
assertClose("lon", roundTrip.lon, sample.lon);

console.log("BTE projection OK");
console.log(`lat/lon ${sample.lat}, ${sample.lon}`);
console.log(`minecraft X/Z ${projected.x}, ${projected.y}`);
