var test = require('tape'),
    TimeSeries = require(__dirname + '/..'),
    fs = require('fs'),
    geojsonhint = require('geojsonhint');

var taxiData = JSON.parse(fs.readFileSync(__dirname + '/../data/taxis.geojson', 'utf8')),
    popData = JSON.parse(fs.readFileSync(__dirname + '/../data/population.geojson', 'utf8'));

test('returns expected output', function(t) {

  var taxiTimeSeries = new TimeSeries({ data: taxiData, dateFormat: 'hour_%H' }),
      popTimeSeries = new TimeSeries({ data: popData, dateFormat: '%Y' });

  var taxiErrors = geojsonhint.hint(taxiTimeSeries.getGeoJSON()),
      popErrors = geojsonhint.hint(popTimeSeries.getGeoJSON());

  t.ok(taxiErrors.length === 0 && popErrors.length === 0, 'valid GeoJSON returned');

  

  t.end();

});
