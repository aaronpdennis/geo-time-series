var Immutable = require('immutable'),
    timeParse = require('d3-time-format').timeParse,
    clustering = require('./clusterfck/'),
    math = require('mathjs'),
    PCA = require('ml-pca'),
    scale = require('d3-scale'),
    color = require('d3-color');

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

  // Cluster indexes for every feature
  var featureClusterAssignments = Immutable.Range(0,features.size).toList();

  switch (input.get('clustering').get('method')) {

    case 'kmeans':

      var kmeans = new clustering.Kmeans();
      var clusters = kmeans.cluster(
        normalizedRatesOfChange.toJS(), // data
        input.get('clustering').get('clusters') //number of clusters
      );

      // Multi-dimensional scaling (with PCA) of centroids for later color assignment
      var centroids = Immutable.fromJS(kmeans.centroids);
      var projectedCentroids = Immutable.fromJS(new PCA(centroids.toJS()).predict(centroids.toJS()).map(function(d,i) {
        return d.slice(0,2);
      }));

      var outputClusterCount = clusters.clusters.length;

      clusters = Immutable.fromJS(clusters.assignment);

      featureClusterAssignments = clusters;

      break;

    // ** Possibly implement hierarchical clustering? ** //
    // case 'hcluster':
    //
    //   var n = input.get('clustering').get('clusters'), splits = 1;
    //   while (n > 2) { n = n / 2; splits++; }
    //   if (n !== 2) {
    //     throw new Error(
    //       'When using hierarchical clustering (hcluster), number of clusters (clusters) ' +
    //       'must be a power of power of 2 (e.g. 2, 4, 8, 16, ..., 2^n)'
    //     )
    //   }
    //
    //   heirarchy = clustering.hcluster(
    //     normalizedRatesOfChange.toJS(), // data
    //     'manhattan',
    //     'average'
    //   );
    //
    //   var clusterHeirarchy = Immutable.fromJS([heirarchy]);
    //
    //   function splitHierarchy(groups) {
    //     return groups.reduce(function(r,branch) {
    //       if (branch.has('left')) { r = r.push(branch.get('left')); }
    //       if (branch.has('right')) { r = r.push(branch.get('right')); }
    //       if (!branch.has('left') && !branch.has('right')) { r = r.push(branch); }
    //       return r;
    //     }, Immutable.List());
    //   }
    //
    //   while (splits > 0) {
    //     var clusterHeirarchy = splitHierarchy(clusterHeirarchy);
    //     splits--;
    //   }
    //
    //   clusterGroups = clusterHeirarchy;
    //
    //   var clusterIndexes = [];
    //   function extractKeys(object) {
    //     if (object.has('left')) { extractKeys(object.get('left')); }
    //     if (object.has('right')) { extractKeys(object.get('right')); }
    //     else if (object.has('key')) {
    //       var featureIndex = object.get('key');
    //       clusterIndexes.push(featureIndex);
    //     }
    //   };
    //
    //   var clusters = clusterGroups.map(function(d) {
    //     clusterIndexes = [];
    //     extractKeys(d);
    //     return clusterIndexes;
    //   });
    //
    //   outputClusterCount = clusters.length;
    //
    //   clusters.map(function(c,i) {
    //     c.map(function(d) {
    //       featureClusterAssignments = featureClusterAssignments.set(d,i);
    //     });
    //   });
    //
    //   break;

    default:
      throw new Error('Clustering method ' + input.get('clustering').get('method') + ' is not supported.');
  }

  // Initialize empty cluster matrices
  var clusterMatrices = Immutable.Range(0, outputClusterCount).toJS()
    .map(function() {
      return Immutable.Range(0,timeGaps.size).toJS()
        .map(function() {
          return [];
        });
    });

  featureClusterAssignments.map(function(d,i) {
    timeGaps.map(function(n,t) {
      clusterMatrices[d][t].push(normalizedRatesOfChange.get(i).get(t));
    });
  });

  var sortedClusterMatrices = clusterMatrices.map(function(cluster) {
    return cluster.map(function(d) {
      return math.sort(d);
    });
  });

  // Summary statistics for rates of change by cluster.
  // * median ratio values per cluster
  // * upper bound (80%) ratio values per cluster
  // * lower bound (80%) ratio values per cluster
  // * max upper bound ratio value
  // * min lower bound ratio value
  var boundGlobalMax = 0,
      boundGlobalMin = 0;

  clusterSummaries = Immutable.fromJS(clusterMatrices.map(function(cluster) {
    return {
      median: cluster.map(function(d) {
        return math.median(d);
      }),
      upperBound: cluster.map(function(d) {
        var value = d[math.ceil(d.length * 0.75 - 1)];
        if (value > boundGlobalMax) { boundGlobalMax = value };
        return value;
      }),
      lowerBound: cluster.map(function(d) {
        var value = d[math.floor(d.length * 0.25 - 1)];
        if (value < boundGlobalMin) { boundGlobalMin = value };
        return value;
      })
    }
  }));

  // The farthest distance a 50% band is from zero
  var chartYRange = math.abs(boundGlobalMin) > math.abs(boundGlobalMax) ?
                    math.abs(boundGlobalMin) : math.abs(boundGlobalMax);

  var first = d3.hcl(input.get('targetColor'));
  first.h += 20;
  first.c += 0;
  first.l += 0;
  console.log(first);
  document.body.style.backgroundColor = first + "";

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

  // Access cluster classification of feature
  this.getFeatureCluster = function(index) { return featureClusterAssignments.get(index) };

}

module.exports = GeoTimeSeries;
