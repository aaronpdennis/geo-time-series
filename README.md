# Visualize Major Trends in Geographic Time Series

## Usage

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

## Developing

With [Browserify](http://browserify.org/):

```
$ watchify ./src/index.js -s TimeSeries -o ./dist/geo-time-series.js
```
