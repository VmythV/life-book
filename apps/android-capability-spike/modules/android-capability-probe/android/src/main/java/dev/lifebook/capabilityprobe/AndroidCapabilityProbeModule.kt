package dev.lifebook.capabilityprobe

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AndroidCapabilityProbeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AndroidCapabilityProbe")

    Function("getPlatformState") {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val keyguardManager = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val exactAlarmCapability = when {
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S -> "not_required"
        alarmManager.canScheduleExactAlarms() -> "exact"
        else -> "approximate_only"
      }

      mapOf(
        "deviceLocked" to keyguardManager.isDeviceLocked,
        "deviceSecure" to keyguardManager.isDeviceSecure,
        "exactAlarmCapability" to exactAlarmCapability,
        "notificationsEnabled" to notificationManager.areNotificationsEnabled(),
        "sdkInt" to Build.VERSION.SDK_INT
      )
    }

    AsyncFunction("setSecureScreen") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      activity.runOnUiThread {
        if (enabled) {
          activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
      }
    }
  }
}
