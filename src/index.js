var Immutable = require('immutable'),
    timeParse = require('d3-time-format').timeParse,
    clustering = require('./clustering/'),
    math = require('mathjs'),
    PCA = require('ml-pca'),
    scale = require('d3-scale'),
    color = require('d3-color'),
    shape = require('d3-shape'),
    select = require('d3-selection');

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
  var relativeMeasurements = measurements.get('features').map(function(d) {
    var mean = math.mean(d.toJS());
    return d.map(function(v) { return v / mean });
  });

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

    var gradients = f.reduce(function(r,d,m) {
      if (m + 1 < f.size) {

        var moment1 = d,
            moment2 = f.get(m + 1);

        var gradient = ((moment2 - moment1) / (moment2 + moment1) / timeGaps.get(m));

        return r.push(gradient);
      } else { return r; }
    }, Immutable.List());

    var standardDeviation = math.std(gradients.toJS());
    var standardizedGradients = gradients.map(function(d) {
      return d / standardDeviation;
    });

    return standardizedGradients;
  });

  // Cluster indexes for every feature
  if (input.get('preclustered') === true) {
    var featureClusterAssignments = features.map(function(feature) {
      return feature.get('cluster');
    });
  } else {

    var featureClusterAssignments = Immutable.Range(0,features.size).toList();

    var kmeans = new clustering.Kmeans();
    var clusters = kmeans.cluster(
      normalizedRatesOfChange.toJS(), // data
      input.get('clusters') //number of clusters
    );

    // Multi-dimensional scaling (with PCA) of centroids for later color assignment
    var centroids = Immutable.fromJS(kmeans.centroids);
    var projectedCentroids = Immutable.fromJS(new PCA(centroids.toJS()).predict(centroids.toJS()).map(function(d,i) {
      return d.slice(0,2);
    }));

    var outputClusterCount = clusters.clusters.length;

    clusters = Immutable.fromJS(clusters.assignment);

    featureClusterAssignments = clusters;

  }

  // Initialize empty cluster matrices
  var clusterMatrices = Immutable.Range(0,input.get('clusters')).toJS()
    .map(function() {
      return Immutable.Range(0,timeGaps.size).toJS()
        .map(function() {
          return [];
        });
    });

  featureClusterAssignments.map(function(d,i) {
    timeGaps.map(function(n,t) {
      var featureData = relativeMeasurements.get(i).get(t);
      clusterMatrices[d][t].push(featureData);
    });
  });

  var sortedClusterMatrices = clusterMatrices.map(function(cluster) {
    return cluster.map(function(d) {
      return math.sort(d);
    });
  });

  var boundGlobalMax = 0;

  clusterSummaries = Immutable.fromJS(clusterMatrices.map(function(cluster) {
    return {
      median: cluster.map(function(d) {
        return math.median(d);
      }),
      upperBound: cluster.map(function(d) {
        var value = d[math.ceil(d.length * 0.80 - 1)];
        if (value > boundGlobalMax) { boundGlobalMax = value };
        return value;
      }),
      lowerBound: cluster.map(function(d) {
        var value = d[math.floor(d.length * 0.20 - 1)];
        return value;
      })
    }
  }));

  // The farthest distance a 50% band is from zero
  var chartYRange = boundGlobalMax;

  if (input.get('preclustered') === true) {

    var clusterColors = Immutable.Range(0,input.get('clusters')).toList();

    features.map(function(feature) {
      clusterColors = clusterColors.set(feature.get('cluster'), feature.get('color'));
    });

  } else {

    var centroidVectors = projectedCentroids.map(function(d) {
      var point = d.toJS();
      var vector = Immutable.fromJS({
        displacement: math.distance([0,0], point),
        angle: math.atan2(point[1],point[0])
      });
      return vector;
    });

    var maxVectorDisplacement = centroidVectors.reduce(function(r,d) {
      return r = r > d.get('displacement') ? r : d.get('displacement');
    }, 0);

    // Scale centroid vectors
    centroidVectors = centroidVectors.map(function(d) {
      d = d.set('displacement', d.get('displacement') / maxVectorDisplacement * 100);
      d = d.set('angle', d.get('angle') / (2 * Math.PI) * 360);
      return d;
    });

    // Colors assigned to clusters.
    var clusterColors = centroidVectors.map(function(d) {
      return color.hcl(d.get('angle'), d.get('displacement'), 50) + "";
    });

    // Residual error from cluster mean for every feature.

    var residualErrors = Immutable.Range(0,input.get('clusters'))
                                  .toList().map(function(d) { return Immutable.List(); });

    geojsonData = geojsonData.update('features', function(fc) {
      return fc.map(function(feature,index) {
        var clusterIndex = featureClusterAssignments.get(index);

        feature = feature.set('cluster', clusterIndex);
        feature = feature.set('color', clusterColors.get(clusterIndex));

        var clusterValues = clusterSummaries.get(clusterIndex).get('median');
        var featureValues = relativeMeasurements.get(index);

        var residualError = clusterValues.reduce(function(r,d,i) {
          return r += math.abs(d - featureValues.get(i));
        }, 0);

        feature = feature.set('residual_error', residualError);
        residualErrors = residualErrors.update(clusterIndex, function(d) { return d.push(residualError); });

        return feature;
      });
    });

    residualErrorSummaries = residualErrors.map(function(d) {
      var sorted = d.sort();
      return Immutable.Map({
        max: sorted.get(-1),
        min: sorted.get(0),
        sd: math.std(sorted.toJS())
      });
    });

    geojsonData = geojsonData.update('features', function(fc) {
      return fc.map(function(feature, index) {
        var clusterIndex = feature.get('cluster');
        return feature.update('residual_error', function(re) {
          var sd = residualErrorSummaries.get(clusterIndex).get('sd'),
              re = re / sd,
              max = residualErrorSummaries.get(clusterIndex).get('max') / sd,
              min = residualErrorSummaries.get(clusterIndex).get('min') / sd;
          var scaled = math.pow(1 - ((re - min) / (max - min)), 2);
          return scaled;
        })
      });
    });
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
  // this.getFeatureCluster = function(index) { return featureClusterAssignments.get(index) };
  //
  // // Access color assigned to cluster
  // this.getClusterColor = function(index) { return clusterColors.get(index) };

  // Function to draw legend
  this.constructLegend = function(elementID) {

    // Select the element where we will put the legend
    var legendElement = document.getElementById(elementID);

    // Get width and height of legend element
    var width = legendElement.offsetWidth,
        height = legendElement.offsetHeight;

    var margin = '0.2em';

    // Get the greater of width or height
    var plotSize = (width >= height ?
        width :
        height / input.get('clusters')) * 0.9;

    // D3 select legend element
    var legend = select.select('#' + elementID);
    legend.selectAll('svg').remove();

    // Setup an SVG legend chart for each cluster
    var charts = [];
    for (var i = 0; i < input.get('clusters'); i++) {
      charts.push(
        legend.append('svg')
          .attr('id', (i).toString())
          .attr('width', plotSize)
          .attr('height', plotSize)
          .style('margin', margin)
          .attr('class', 'legendChart')
      );
    }

    // Create scales for legend charts
    var yScale = scale.scaleLinear().domain([0, chartYRange]).range([plotSize, 0]),
        xScale = scale.scaleLinear().domain([0, timeGaps.size - 1]).range([0, plotSize]);

    var sortedClusterSummaries = clusterSummaries.map(function(d,i) {
      // add color to cluster summary information
      return d.set('color', clusterColors.get(i));
    }).sort(function(a,b) {
      // sorting by 'hue' in HCL color space
      return color.hcl(b.get('color')).h - color.hcl(a.get('color')).h;
    });

    // Generate legend charts
    charts.map(function(plot, c) {
      var summary = sortedClusterSummaries.get(c);

      var area = shape.area()
        .x(function(d,i) {
          return xScale(i);
        })
        .y0(function(d,i) {
          var bound = summary.get('lowerBound').get(i);
          if (bound === undefined) { bound = summary.get('median').get(i) }
          return yScale(bound);
        })
        .y1(function(d,i) {
          var bound = summary.get('upperBound').get(i);
          if (bound === undefined) { bound = summary.get('median').get(i) }
          return yScale(bound);
        })
        .curve(d3.curveMonotoneX);

      var line = shape.line()
        .x(function(d,i) {
          return xScale(i);
        })
        .y(function(d,i) {
          var median = summary.get('median').get(i);
          return yScale(median);
        })
        .curve(d3.curveMonotoneX);

      var axis = shape.line()
        .x(function(d,i) {
          return xScale(i);
        })
        .y(yScale(1));

      // Background
      var background = '#eee';
      plot.append('rect')
        .attr('height', plotSize)
        .attr('width', plotSize)
        .style('fill', background);

      // Cluster color background
      plot.append('rect')
        .attr('height', plotSize)
        .attr('width', plotSize)
        .style('fill', summary.get('color'))
        .style('opacity', 0.1);

      // Mean axis
      plot.append('path')
        .datum(timeGaps.toJS())
        .attr('stroke', '#fff')
        .attr('stroke-width', plotSize * 0.015)
        .attr('opacity', 0.5)
        .attr('d', axis)
        .attr('fill', 'none');

      // Band representing 50% of clusters
      plot.append('path')
        .datum(timeGaps.toJS())
        .attr('fill-opacity', 0.5)
        .attr('d', area)
        .attr('fill', summary.get('color'));

      // Median line
      plot.append('path')
        .datum(timeGaps.toJS())
        .attr('stroke-width', plotSize * 0.015)
        .attr('stroke', summary.get('color'))
        .attr('fill', 'none')
        .attr('d', line);

    })
  }

}

module.exports = GeoTimeSeries;
