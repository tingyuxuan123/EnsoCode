package io.github.tingyuxuan123.eaves.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Bundled QR model: no account, Google Play Services installation or network model download. */
@Composable
internal fun PairingScanner(onCode: (String) -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var asked by rememberSaveable { mutableStateOf(false) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    if (granted) {
        CameraPreview(onCode)
    } else {
        val permanentlyDenied = asked && (context as? Activity)?.shouldShowRequestPermissionRationale(Manifest.permission.CAMERA) == false
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Label(if (permanentlyDenied) "在设置中允许相机" else "开启相机扫码", 15, 22,
                Modifier.clickable {
                    if (permanentlyDenied) context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.fromParts("package", context.packageName, null)))
                    else { asked = true; permission.launch(Manifest.permission.CAMERA) }
                }.padding(16.dp), color = Color.White)
        }
    }
}

@androidx.annotation.OptIn(ExperimentalGetImage::class)
@Composable
private fun CameraPreview(onCode: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val currentCode by rememberUpdatedState(onCode)
    val camera = remember { LifecycleCameraController(context) }
    var unavailable by remember { mutableStateOf(false) }
    var decoded by remember { mutableStateOf(false) }
    DisposableEffect(camera, owner) {
        val executor = Executors.newSingleThreadExecutor()
        val active = AtomicBoolean(true)
        val processing = AtomicBoolean(false)
        val delivered = AtomicBoolean(false)
        val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
        camera.setImageAnalysisAnalyzer(executor) { proxy ->
            val media = proxy.image
            if (!active.get() || delivered.get() || media == null || !processing.compareAndSet(false, true)) {
                proxy.close()
            } else {
                try {
                    scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
                        .addOnSuccessListener(ContextCompat.getMainExecutor(context)) { codes ->
                            val code = codes.firstNotNullOfOrNull { it.rawValue?.takeIf { value ->
                                value.length <= 8192 && (value.startsWith("enso://pair?") || value.startsWith("https://") || value.startsWith("http://127.0.0.1"))
                            } }
                            if (active.get() && code != null && delivered.compareAndSet(false, true)) {
                                decoded = true
                                currentCode(code)
                            }
                        }.addOnCompleteListener { processing.set(false); proxy.close() }
                } catch (_: Exception) {
                    processing.set(false)
                    proxy.close()
                }
            }
        }
        try { camera.bindToLifecycle(owner) } catch (_: Exception) { unavailable = true }
        onDispose {
            active.set(false)
            camera.clearImageAnalysisAnalyzer()
            camera.unbind()
            scanner.close()
            executor.shutdown()
        }
    }
    if (!unavailable) AndroidView(factory = { PreviewView(it).apply {
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        scaleType = PreviewView.ScaleType.FILL_CENTER
        controller = camera
    } }, modifier = Modifier.fillMaxSize())
    if (unavailable || decoded) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Label(if (decoded) "已识别，请点配对" else "相机不可用，请粘贴配对链接", 14, 20, color = Color.White)
    }
}
