var Immutable = require('immutable'),
    timeParse = require('d3-time-format').timeParse,
    clustering = require('./clusterfck/');

function GeoTimeSeries (input) {

  var start = Date.now()

  input = Immutable.fromJS(input);

  // Input GeoJSON
  var geojsonData = Immutable.fromJS(input.get('data'));

  // Date Parser
  var dateParse = timeParse(input.get('dateFormat'));

  // Moments (times) of measurement found in all features. Expects every feature to have the same moments of measurements.
  var moments;

  // A set of chronological measurements for every feature and min/max values for each moment.
  var measurements = {
    minimums: [],
    maximums: [],
    features: []
  };

  var features = geojsonData.get('features');

  features.map(function(f,i) {

    // Extract feature's properties
    var featureProperties = f.get('properties');

    // Filter out time series data and sort chronologically
    var lastDate;
    var featureTimeSeries = featureProperties.filter(function(value, key) {
      var date = dateParse(key);
      return date instanceof Date;
    }).sortBy(function(value, key) {
      if (lastDate === undefined) { lastDate = dateParse(key).getTime() }
      return dateParse(key).getTime() - lastDate;
    });

    // Collect list of measurement moments
    var featureDates = featureTimeSeries.keySeq();
    if (moments === undefined) { moments = featureDates; }
    if (!featureDates.equals(moments)) {
      throw new Error('Every input feature must have the same time moments of measurement.');
    }

    moments = featureDates;

    measurements.features.push([]);
    // Collect measurements chronologically
    moments.toList().map(function(d) {
      var value = featureProperties.get(d);

      // Determine minimum measurement for feature
      if (value < measurements.minimums[i] || measurements.minimums[i] === undefined) {
        measurements.minimums[i] = value
      }
      // Determine maximum measurement for feature
      if (value > measurements.maximums[i] || measurements.maximums[i] === undefined) {
        measurements.maximums[i] = value
      }

      measurements.features[i].push(value);
    });

  });

  measurements = Immutable.fromJS(measurements);

  // Create a list of moments as JavaScript Date objects
  var chronology = Immutable.fromJS(moments.map(function(d) {
    return dateParse(d);
  }));

  // Total number of milliseconds between first and last measurements
  var totalElapsedTime = chronology.get(chronology.size - 1) - chronology.get(0);

  // A list of the lengths of time between measurements as ratios of total time between first and last measurement
  var timeGaps = chronology.reduce(function(r,d,i) {
    if (i + 1 < chronology.size) {
      var gap = chronology.get(i + 1).getTime() - d.getTime();
      var relativeGap = gap / (totalElapsedTime / (chronology.size - 1));
      return r.push(relativeGap);
    } else { return r; }
  }, Immutable.List());

  // A set of normalized rates of change between moments for every feature
  var normalizedRatesOfChange = measurements.get('features').map(function(f,i) {

    // normalize based on standard deviations???

    var gradients = f.reduce(function(r,d,m) {
      if (m + 1 < f.size) {

        var moment1 = d,
            moment2 = f.get(m + 1);

        var gradient = ((moment2 - moment1) / (moment2 + moment1) / timeGaps.get(m));

        return r.push(gradient);
      } else { return r; }
    }, Immutable.List());

    return gradients;
  });

  var clusters;
  switch (input.get('clustering').get('method')) {

    case 'kmeans':

      clusters = clustering.kmeans(
        normalizedRatesOfChange.toJS(), // data
        input.get('clustering').get('clusters') //number of clusters
      );

      break;

    case 'hcluster':

      var n = input.get('clustering').get('clusters'), splits = 1;
      while (n > 2) { n = n / 2; splits++; }
      if (n !== 2) {
        throw new Error(
          'When using hierarchical clustering (hcluster), number of clusters (clusters) ' +
          'must be a power of power of 2 (e.g. 2, 4, 8, 16, ..., 2^n)'
        )
      }

      clusters = clustering.hcluster(
        normalizedRatesOfChange.toJS() // data
      );

      // `key` will be the item's feature index


      for (var i = 0; i < splits; i++) {


      }

      var groups = [];
      function splitHierarchy(branch) {
        if (splits > 0) {
          if (branch.has('left')) {
            groups.push(branch.get('left'));
            splitHierarchy(groups[groups.length - 1])
          }
          if (branch.has('right')) {
            groups.push(branch.get('right'));
          }
        }
        splits--;
      }

      var keys = [];
      (function extractKeys(object) {
        if (object.has('left')) { extractKeys(object.get('left')); }
        if (object.has('right')) { extractKeys(object.get('right')); }
        else if (object.has('key')) {
          var featureIndex = object.get('key');
          if (keys.indexOf(featureIndex) > -1) { console.log('already included', featureIndex);}
          keys.push(featureIndex);
        }
      })(Immutable.fromJS(clusters));

      console.log('number of features:', keys.length);

      break;

    default:
      throw new Error('Clustering method ' + input.get('clustering').get('method') + ' is not supported.');
  }


  console.log(clusters);

  // Feature indexes grouped by cluster.
  var featureClusters = [];

  // Averaged rates of change by cluster.
  var meanRatesOfChangeByCluster = [];

  // Colors assigned to clusters.
  var clusterColors = [];

  // Residual error from cluster mean for every feature.
  var residualError = {
    maximum: 0,
    minimum: 0,
    features: []
  }

  // Output GeoJSON
  this.getGeoJSON = function() { return geojsonData.toJS() };

  // Access measurement chronology array
  this.getChronology = function() { return chronology.toJS() };

  // Access useful arrays of feature measurements and feature min/max measurements
  this.getFeatureMeasurements = function(index) { return measurements.get('features').get(index).toJS() };
  this.getFeatureMinimum = function(index) { return measurements.get('minimums').get(index) };
  this.getFeatureMaximum = function(index) { return measurements.get('maximums').get(index) };

  // Access lists of feature indexes grouped by cluster
  this.getClusters = function() { return clusters.toJS() };

}

module.exports = GeoTimeSeries;
