let map, infoPopup, submitPopup, points = []

const submitPopupContent = {
  ask: '<span id="add-location" onclick="editNewLocation()" style="font-weight: bold">Add litter location?</span>',
  edit: '<div id="edit-new-location"></div>'
}

const infoPopupContent = {
  view: '<div id="view-location"></div>'
}

function initMap() {
  //
  // Google Maps API
  //
  // Documentation: https://developers.google.com/maps/documentation/javascript/reference/
  //

  map = new google.maps.Map(document.getElementById('map'), {
    center: new google.maps.LatLng(35.899532, -79.056473),
    zoom: config.map.default_zoom,
    mapTypeId: google.maps.MapTypeId.HYBRID,
    mapTypeControl: false,
    fullscreenControl: false,
    // React to all touch and scroll events
    gestureHandling: "greedy"
  })

  const streetView = map.getStreetView()

  // Hide the full screen control in street view mode
  streetView.setOptions({
    fullscreenControl: false
  })

  infoPopup = new google.maps.InfoWindow({
    content: infoPopupContent.view
  })

  google.maps.event.addListener(infoPopup, 'closeclick', () => {
    window.actions.updateShowingLocation(false)
  })

  submitPopup = new google.maps.InfoWindow()

  google.maps.event.addListener(submitPopup, 'closeclick', () => {
    window.actions.updateEditingNewLocation(false)
  })

  map.addListener("click", () => {
    window.actions.updateShowingLocation(false)
    infoPopup.close()
  })

  // Tap into mouse events to detect long clicks
  map.addListener("mousedown", mapMouseDown)
  map.addListener("mouseup", mapMouseUp)

  // Respond to changes in map bounds
  map.addListener("bounds_changed", boundsChanged)

  // Respond to entering and exiting street view mode
  google.maps.event.addListener(streetView, "visible_changed",
    () => {
      window.actions.updateShowingStreetView(streetView.getVisible())
    }
  )

  // Allow interaction with the map object from the console (in development)
  if (config.development) {
    window.map = map
  }
}

let downState

function mapMouseDown(event) {
  where = event.latLng

  where = {
    lat: where.lat(),
    lon: where.lng()
  }

  if (downState)
    clearTimeout(downState.timer)

  downState = {
    center: getCenter(),
    timer: setTimeout(() => {
      checkLongClicked(where, 700)
    }, config.map.long_click_interval)
  }
}

function mapMouseUp() {
  if (downState) {
    clearTimeout(downState.timer)
    downState = null
  }
}

function checkLongClicked({lat, lon}) {
  let center = getCenter()

  // If the map center has moved, this is a drag and not a long click
  if (downState.center.lat === center.lat && downState.center.lon === center.lon)
    if (map.getZoom() >= config.map.min_add_location_zoom)
     offerToAddLocation({lat, lon})

  downState = null
}

let candidateLocation

function offerToAddLocation({lat, lon}) {
  candidateLocation = {lat, lon}

  submitPopup.setPosition(
    new google.maps.LatLng(lat, lon)
  )

  submitPopup.setContent(
    submitPopupContent.ask
  )

  window.actions.updateEditingNewLocation(false)

  submitPopup.open({
    map
  })
}

function editNewLocation() {
  submitPopup.setContent(
    submitPopupContent.edit
  )

  window.actions.updateEditingNewLocation(true)
}

function closeSubmitPopup() {
  submitPopup.close()
}

function goTo({ lat, lon, zoom}) {
  map.setCenter({lat, lng: lon})

  if (zoom)
    map.setZoom(zoom)
}

function getCenter() {
  let { lat, lng } = map.getCenter()

  return {
    lat: lat(),
    lon: lng()
  }
}

function getViewRadius() {
  let bounds = map.getBounds()

  let ne = bounds.getNorthEast()
  let sw = bounds.getSouthWest()

  let x = (ne.lng() - sw.lng()) / 2
  let y = (ne.lat() - sw.lat()) / 2

  return Math.sqrt(x*x + y*y)
}

function toggleBaseLayer() {
  map.setMapTypeId(
    map.getMapTypeId() === "hybrid" ? "roadmap" : "hybrid"
  )
}

function geolocateMe() {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const pos = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      }

      goTo({ ...pos, zoom: 16 })
    }
  )
}

function boundsChanged() {
  requestLocations()
  window.actions.updateZoom(map.getZoom())
}

let debouncing = false
let needToUpdate = false

function requestLocations() {
  if (!debouncing) {
    debouncing = true
    loadLocations()

    setTimeout(
      () => {
        debouncing = false

        if (needToUpdate) {
          needToUpdate = false
          loadLocations()
        }
      },
      config.map.data_update_debounce
    )
  } else
    needToUpdate = true
}

async function loadLocations() {
  let { lat, lon } = getCenter()
  let radius = getViewRadius()

  let url = `/radius/?lat=${lat}&lon=${lon}&r=${radius}&format=geojson`

  console.log("Fetching litter locations...")
  let res = await fetch(config.backend + url)

  if (res.ok) {
    let json = await res.json()
    let count = json.features.length
    let countInfo = count + ((count !== 1) ? " locations" : " location")

    console.log("Received " + countInfo)

    renderLocations(json.features)
  } else
    console.log("Failed to fetch litter locations: " + res.status)
}

function renderLocations(features) {
  //
  // Render new markers first and then remove old markers that aren't in the new set
  //
  let newPoints = []

  features.forEach((item) => {
    let hash = item.properties.hash

    let found = points.findIndex((x) => x.hash === hash)

    if (found !== -1) {
      newPoints.push(points[found])
      points.splice(found, 1)
    } else {
      let coords = item.geometry.coordinates
      let data = item.properties

      let marker = new google.maps.Marker({
        position: new google.maps.LatLng(coords[1], coords[0]),
        // icon: {
        //   url: "favicon.ico",
        //   scaledSize: new google.maps.Size(30, 30)
        // },
        map
      })

      let point = {
        data: item.properties,
        hash: item.properties.hash,
        coords: {
          lat: coords[1],
          lon: coords[0]
        },
        marker
      }

      marker.addListener("click", () => {
        infoPopup.open({
          anchor: marker,
          map
        })

        setTimeout(() => {
          window.actions.updateShowingLocation(true, point.data)
        })
      })

      newPoints.push(point)
    }
  })

  //
  // Remove markers from the map that aren't in the new set
  //
  points.forEach((item) => {
    item.marker.setMap(null)
  })

  points = newPoints

  if (config.development) {
    window.points = points
  }
}

function submitLocation({description, level}) {
  submitPopup.close()

  let data = {
    ...candidateLocation,
    description,
    level
  }

  let request = new XMLHttpRequest()
  request.open('POST', config.backend + '/add')
  request.withCredentials = true
  request.send(JSON.stringify(data))

  request.onload = () => {
    alert("Thank you for submitting this point.\n\nHelp us crowd source environmental cleanup by building a knowledge base of locations that need litter and/or plastic pollution cleanup. Become a part of the process to clean up the planet and restore it to its natural beauty with the ease of “spotting” locations that others can attend to. If you are one of the thousands of cleanup enthusiasts worldwide, use the map to locate your next cleanup.")

    loadLocations()
  }
}

export {
  map,
  goTo,
  getCenter,
  toggleBaseLayer,
  geolocateMe,
  closeSubmitPopup,
  submitLocation
}

//
// Expose this so it can be invoked from the popup event handler
//
window.editNewLocation = editNewLocation

//
// Expose this so the Google Maps API script can invoke it
//
window.initMap = initMap
