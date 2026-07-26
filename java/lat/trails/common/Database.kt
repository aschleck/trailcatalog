package lat.trails.common

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag

@FlagSpec("database_username_password")
private val databaseUsernamePassword = createFlag("unset")

@FlagSpec("database_url")
private val databaseUrl = createFlag("unset")

@FlagSpec("trailcatalog_database_username_password")
private val trailcatalogDatabaseUsernamePassword = createFlag("unset")

@FlagSpec("trailcatalog_database_url")
private val trailcatalogDatabaseUrl = createFlag("unset")

fun createBaseConnection(): HikariDataSource {
  return HikariDataSource(HikariConfig().apply {
    jdbcUrl = "jdbc:" + databaseUrl.value
    val split = databaseUsernamePassword.value.split(':', limit = 2)
    username = split[0]
    password = split[1]
  })
}

fun createTrailcatalogConnection(): HikariDataSource {
  return HikariDataSource(HikariConfig().apply {
    jdbcUrl = "jdbc:" + trailcatalogDatabaseUrl.value
    val split = trailcatalogDatabaseUsernamePassword.value.split(':', limit = 2)
    username = split[0]
    password = split[1]
  })
}
