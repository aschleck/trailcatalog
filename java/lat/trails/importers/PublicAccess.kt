package lat.trails.importers

import mil.nga.geopackage.GeoPackageManager
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createNullableFlag
import org.trailcatalog.flags.parseFlags
import java.nio.file.Path

@FlagSpec(name = "source")
val source = createNullableFlag(null as Path?)

//private data class Area(val manager)

fun main(args: Array<String>) {
  parseFlags(args)

  val manager = GeoPackageManager.open(source.value!!.toFile())
  val owners = HashMap<String, HashMap<String, Int>>()
  val dao = p.getFeatureDao()
  for (result in dao.queryForAll()) {
    val owner = result.getValue("Own_Name").toString()
    val access = result.getValue("Pub_Access").toString()
    if (owner != "BLM" || access != "XA") {
      continue
    }

    for (i in 0 until result.columns.columnCount()) {
      print("${result.columnNames[i]}=${result.values[i]}, ")
    }
    println()
  }

//  val departmentOwners = hashSetOf("DOD", "DOE")
//  val fwsOwners = hashSetOf("FWS")
//  val federalOwners = hashSetOf("OTHF")
//  val ignoreOwners = hashSetOf("OTHF", "PW", "PVT", "NGO", "TVA")
//  val stateOwners = hashSetOf("OTHS", "SDC", "SDNR", "SDOL", "SFW", "SLB")
//  val localOwners = hashSetOf("CITY", "CNTY")
//  val tribalOwners = hashSetOf("TRIB")
  // USBR OTHR PVT NRCS USACE JNT UNK SPR DOD UNKL RWD GU
  // FWS VI REG

  for (table in listOf("PADUS3_0Fee", "PADUS3_0Marine")) {
    for (result in manager.getFeatureDao(table).queryForAll()) {
      val owner = result.getValue("Own_Name").toString()
      when (owner) {
      }
      val access = result.getValue("Pub_Access").toString()
      if (access)
      val slice = owners.getOrPut(owner) { HashMap() }
      slice[access] = slice.getOrDefault(access, 0) + 1
    }
  }

  println(owners)
}