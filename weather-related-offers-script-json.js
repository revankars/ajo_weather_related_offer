const apiKey = "02921f56f5e20476dfedbae7b43dfb58";

// Wait for Alloy to load (since Adobe Launch injects it async)
function waitForAlloy(callback, interval = 100, retries = 50) {
  if (typeof alloy === "function") {
    callback();
  } else if (retries > 0) {
    setTimeout(() => waitForAlloy(callback, interval, retries - 1), interval);
  } else {
    console.error("❌ Alloy is not available after multiple attempts.");
  }
}

// Decode HTML safely
function decodeHtml(html) {
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

// UUID generator
function generateUUID() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// Get ECID
function getECID() {
  try {
    return _satellite.getVar("ECID");
  } catch (e) {
    console.warn("ECID not available via _satellite.");
    return null;
  }
}

// Main function
function sendWeatherDataToAEP() {
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial`
    )
      .then(res => res.json())
      .then(data => {
        const temp = Math.round(data.main.temp);
        const condition = data.weather[0].main;
        const city = data.name;

        document.getElementById("weatherStatus").textContent =
          `Current temperature in ${city} is ${temp}°F with ${condition}.`;

        // AJO request
        return alloy("sendEvent", {
          renderDecisions: true,
          personalization: {
            surfaces: [
              "web://revankars.github.io/ajo_weather_related_offer/weather-offers-json.html#offerContainer"
            ]
          },
          xdm: {
            eventType: "decisioning.request",
            _dentsuglobalpartnersbx: {
              temperature: temp,
              weatherConditions: condition,
              cityName: city
            }
          }
        });
      })
      .then(response => {
        const offerDiv = document.getElementById("offerContainer");
        offerDiv.innerHTML = "";

        const impressionItems = [];

        const propositions = response.propositions || [];
        window.latestPropositions = propositions;

        // Normalize offers
        const allOffers = [];

        propositions.forEach(proposition => {
          const items = proposition.items || [];

          items.forEach(item => {
            const contents = item.data?.content || [];

            contents.forEach(c => {
              allOffers.push({
                proposition,
                html: c["offer-item"],
                offerId: proposition.id,
                trackingToken:
                  proposition.scopeDetails?.characteristics?.eventToken
              });
            });
          });
        });

        if (!allOffers.length) {
          offerDiv.innerHTML =
            "<p>No AJO JSON offers returned because Campaign is inactive</p>";
          return;
        }

        // Render offers
        allOffers.forEach(offer => {
          const decoded = decodeHtml(offer.html || "");

          const tempDiv = document.createElement("div");
          tempDiv.innerHTML = decoded;

          [...tempDiv.children].forEach(child => {
            offerDiv.appendChild(child);

            // Track impression data
            impressionItems.push({
              proposition: offer.proposition,
              offerId: offer.offerId,
              trackingToken: offer.trackingToken
            });

            // Click tracking
            child.querySelectorAll("a, button").forEach(el => {
              el.addEventListener("click", () => {
                const ecidValue = getECID();

                if (!ecidValue || !offer.offerId || !offer.trackingToken) {
                  console.warn("Missing tracking data");
                  return;
                }

                alloy("sendEvent", {
                  xdm: {
                    _id: generateUUID(),
                    timestamp: new Date().toISOString(),
                    eventType: "decisioning.propositionInteract",
                    identityMap: {
                      ECID: [
                        {
                          id: ecidValue,
                          authenticatedState: "ambiguous",
                          primary: true
                        }
                      ]
                    },
                    _experience: {
                      decisioning: {
                        propositionEventType: { interact: 1 },
                        propositionAction: {
                          id: offer.offerId,
                          tokens: [offer.trackingToken]
                        },
                        propositions: [offer.proposition]
                      }
                    }
                  }
                });
              });
            });
          });
        });

        // Impression event
        const ecidValue = getECID();

        if (ecidValue) {
          impressionItems.forEach(offer => {
            alloy("sendEvent", {
              xdm: {
                _id: generateUUID(),
                timestamp: new Date().toISOString(),
                eventType: "decisioning.propositionDisplay",
                identityMap: {
                  ECID: [
                    {
                      id: ecidValue,
                      authenticatedState: "ambiguous",
                      primary: true
                    }
                  ]
                },
                _experience: {
                  decisioning: {
                    propositionEventType: { display: 1 },
                    propositionAction: {
                      id: offer.offerId,
                      tokens: [offer.trackingToken]
                    },
                    propositions: [offer.proposition]
                  }
                }
              }
            })
            .then(() => console.log("✅ propositionDisplay sent"))
            .catch(console.error);
          });
        } else {
          console.warn("Missing ECID. Skipping display event.");
        }
      })
      .catch(err => {
        console.error("❌ Personalization failed:", err);
      });
  });
}

// Run after Alloy is available
waitForAlloy(sendWeatherDataToAEP);
