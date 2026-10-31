package lat.trails.wire

// Pressure levels in hPa, about 2,500 to 18,000 feet, where planes fly below Class A
val WIND_LEVELS = listOf(925, 850, 700, 600, 500)

// in hours
val PEAK_WINDOWS = listOf(12, 24, 72, 120)

// Pressure levels in hPa, about 5,000 to 30,000 feet
val ICING_LEVELS = listOf(850, 700, 600, 500, 400, 300)

// Pairs of pressure levels in hPa, about 24,000 to 44,000 feet, where jet streams make clear air
// turbulence
val TURBULENCE_LAYERS = listOf(400 to 300, 300 to 250, 250 to 200, 200 to 150)
