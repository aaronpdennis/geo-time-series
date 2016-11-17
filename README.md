# Visualize Major Trends in Geographic Time Series

## Usage

Include [dist/geo-time-series.js](https://github.com/aaronpdennis/time-series-trends/blob/master/dist/time-series-trends.js):
``` html
<script src='https://rawgit.com/aaronpdennis/geo-time-series/master/dist/geo-time-series.js'></script>
```

API:
``` javascript
timeSeries = new TimeSeries({
  data: geoJsonData,  // GeoJSON object with time series properties and values for each feature
  dateFormat: '%Y',   // A string specifier for how moments of measurement property names are formatted
  clusters: 8         // Number of clusters
});

// Construct an SVG legend in a specific element
timeSeries.constructLegend('legendElementID');

// Get back a GeoJSON object with information about cluster and color assignments included in feature attributes
var geojson = timeSeries.getGeoJSON();
```

Date format reference: https://github.com/d3/d3-time-format/blob/master/README.md#locale_format

## Example

See a [live visualization](http://aaronpdennis.github.io/geo-time-series) or adopt the [source code](https://github.com/aaronpdennis/geo-time-series/blob/master/index.html).

## Developing

With [Browserify](http://browserify.org/):

```
$ watchify ./src/index.js -s TimeSeries -o ./dist/geo-time-series.js
```
