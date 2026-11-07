package ir.starclient.hud;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.client.util.InputUtil;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.util.math.BlockPos;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Locale;

/**
 * First client-side Star HUD for Fabric 1.21.1.
 * Configuration is written by the Star Client launcher to config/star-client.json.
 */
public final class StarHudClient implements ClientModInitializer {
    private static final Logger LOGGER = LoggerFactory.getLogger("Star HUD");
    private static final int PANEL_COLOR = 0xA9101013;
    private static final int PANEL_BORDER = 0xB52A2A30;
    private static final int ACCENT_COLOR = 0xFFFF7A1A;
    private static final Deque<Long> LEFT_CLICKS = new ArrayDeque<>();

    private static HudConfig config = new HudConfig();
    private static KeyBinding zoomKey;
    private static KeyBinding sprintToggleKey;
    private static boolean previousAttackPressed;
    private static boolean isZooming;
    private static int originalFov = 70;
    private static boolean sprintToggled;

    @Override
    public void onInitializeClient() {
        loadConfig();
        zoomKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.starclient.zoom", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_C, "category.starclient"));
        sprintToggleKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.starclient.toggle_sprint", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_V, "category.starclient"));

        ClientTickEvents.END_CLIENT_TICK.register(StarHudClient::onClientTick);
        HudRenderCallback.EVENT.register(StarHudClient::renderHud);
        LOGGER.info("Star HUD initialized for Minecraft 1.21.1");
    }

    private static void loadConfig() {
        Path file = FabricLoader.getInstance().getGameDir().resolve("config").resolve("star-client.json");
        if (!Files.isRegularFile(file)) {
            config = new HudConfig();
            LOGGER.info("No Star Client config found; using safe defaults");
            return;
        }

        try {
            JsonElement parsed = JsonParser.parseString(Files.readString(file));
            if (!parsed.isJsonObject()) {
                throw new IllegalArgumentException("Expected a JSON object");
            }
            JsonObject json = parsed.getAsJsonObject();
            HudConfig next = new HudConfig();
            next.fps = bool(json, "fps", next.fps);
            next.coords = bool(json, "coords", next.coords);
            next.cps = bool(json, "cps", next.cps);
            next.keystrokes = bool(json, "keystrokes", next.keystrokes);
            next.ping = bool(json, "ping", next.ping);
            next.armor = bool(json, "armor", next.armor);
            next.toggleSprint = bool(json, "toggleSprint", next.toggleSprint);
            next.zoom = bool(json, "zoom", next.zoom);
            next.zoomFactor = number(json, "zoomFactor", next.zoomFactor);
            next.textColor = string(json, "textColor", next.textColor);
            next.validate();
            config = next;
        } catch (RuntimeException | IOException ex) {
            config = new HudConfig();
            LOGGER.warn("Could not read Star Client config at {}; using defaults", file, ex);
        }
    }

    private static boolean bool(JsonObject json, String key, boolean fallback) {
        JsonElement value = json.get(key);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean()
                ? value.getAsBoolean() : fallback;
    }

    private static double number(JsonObject json, String key, double fallback) {
        JsonElement value = json.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return fallback;
        return value.getAsDouble();
    }

    private static String string(JsonObject json, String key, String fallback) {
        JsonElement value = json.get(key);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()
                ? value.getAsString() : fallback;
    }

    private static void onClientTick(MinecraftClient client) {
        long now = System.currentTimeMillis();
        boolean attackPressed = client.currentScreen == null && client.options.attackKey.isPressed();
        if (attackPressed && !previousAttackPressed) LEFT_CLICKS.addLast(now);
        previousAttackPressed = attackPressed;
        while (!LEFT_CLICKS.isEmpty() && now - LEFT_CLICKS.peekFirst() > 1000L) LEFT_CLICKS.removeFirst();

        if (client.player == null || client.world == null) {
            restoreFov(client);
            sprintToggled = false;
            return;
        }

        if (config.zoom && client.currentScreen == null && zoomKey.isPressed()) {
            if (!isZooming) {
                originalFov = client.options.getFov().getValue();
                int targetFov = (int) Math.max(5, Math.min(70, Math.round(originalFov / config.zoomFactor)));
                client.options.getFov().setValue(targetFov);
                isZooming = true;
            }
        } else {
            restoreFov(client);
        }

        while (sprintToggleKey.wasPressed()) sprintToggled = !sprintToggled;
        if (config.toggleSprint && sprintToggled) {
            boolean canSprint = client.player.forwardSpeed > 0.01f
                    && !client.player.isSneaking()
                    && client.player.getHungerManager().getFoodLevel() > 6;
            if (canSprint) client.player.setSprinting(true);
            else if (!client.options.sprintKey.isPressed()) client.player.setSprinting(false);
        }
    }

    private static void restoreFov(MinecraftClient client) {
        if (isZooming) {
            client.options.getFov().setValue(originalFov);
            isZooming = false;
        }
    }

    private static void renderHud(DrawContext context, RenderTickCounter tickCounter) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.world == null || client.options.hudHidden) return;

        int textColor = parseColor(config.textColor);
        List<String> lines = new ArrayList<>();
        if (config.fps) lines.add("FPS  " + client.getCurrentFps());
        if (config.coords) {
            BlockPos pos = client.player.getBlockPos();
            lines.add(String.format(Locale.ROOT, "XYZ  %d  %d  %d", pos.getX(), pos.getY(), pos.getZ()));
        }
        if (config.ping) lines.add("PING  " + getPing(client));
        if (config.cps) lines.add("CPS  " + LEFT_CLICKS.size());
        if (config.armor) lines.add(getArmorText(client.player.getInventory()));

        int y = 8;
        for (String line : lines) {
            int width = client.textRenderer.getWidth(line);
            context.fill(4, y - 3, width + 14, y + 10, PANEL_COLOR);
            context.drawBorder(4, y - 3, width + 10, 13, PANEL_BORDER);
            context.drawTextWithShadow(client.textRenderer, line, 9, y, textColor);
            y += 15;
        }

        if (config.keystrokes) renderKeystrokes(context, client);
    }

    private static String getPing(MinecraftClient client) {
        if (client.isInSingleplayer() || client.getNetworkHandler() == null || client.player == null) return "--";
        PlayerListEntry entry = client.getNetworkHandler().getPlayerListEntry(client.player.getUuid());
        return entry == null ? "--" : entry.getLatency() + " ms";
    }

    private static String getArmorText(PlayerInventory inventory) {
        StringBuilder result = new StringBuilder("ARMOR ");
        // PlayerInventory stores armor from boots to helmet, so reverse it for display.
        for (int i = 3; i >= 0; i--) {
            ItemStack stack = inventory.getArmorStack(i);
            if (stack.isEmpty()) {
                result.append("-- ");
            } else if (stack.isDamageable()) {
                int remaining = Math.max(0, stack.getMaxDamage() - stack.getDamage());
                int percent = stack.getMaxDamage() == 0 ? 100 : remaining * 100 / stack.getMaxDamage();
                result.append(percent).append("% ");
            } else {
                result.append("OK ");
            }
        }
        return result.toString().trim();
    }

    private static void renderKeystrokes(DrawContext context, MinecraftClient client) {
        int bottom = client.getWindow().getScaledHeight() - 20;
        int center = 31;
        drawKey(context, client, "W", client.options.forwardKey.isPressed(), center, bottom - 45);
        drawKey(context, client, "A", client.options.leftKey.isPressed(), center - 22, bottom - 23);
        drawKey(context, client, "S", client.options.backKey.isPressed(), center, bottom - 23);
        drawKey(context, client, "D", client.options.rightKey.isPressed(), center + 22, bottom - 23);
        drawKey(context, client, "SPACE", client.options.jumpKey.isPressed(), center, bottom - 1, 62);
    }

    private static void drawKey(DrawContext context, MinecraftClient client, String label,
                                boolean pressed, int centerX, int y) {
        drawKey(context, client, label, pressed, centerX, y, 18);
    }

    private static void drawKey(DrawContext context, MinecraftClient client, String label,
                                boolean pressed, int centerX, int y, int width) {
        int left = centerX - width / 2;
        int fill = pressed ? 0xD8FF7A1A : PANEL_COLOR;
        context.fill(left, y, left + width, y + 18, fill);
        context.drawBorder(left, y, width, 18, pressed ? ACCENT_COLOR : PANEL_BORDER);
        int textWidth = client.textRenderer.getWidth(label);
        context.drawTextWithShadow(client.textRenderer, label, centerX - textWidth / 2, y + 5,
                pressed ? 0xFF171717 : 0xFFFFFFFF);
    }

    private static int parseColor(String value) {
        if (value == null || !value.matches("#[0-9a-fA-F]{6}")) return 0xFFFFFFFF;
        try {
            return 0xFF000000 | Integer.parseInt(value.substring(1), 16);
        } catch (NumberFormatException ignored) {
            return 0xFFFFFFFF;
        }
    }

    private static final class HudConfig {
        private boolean fps = true;
        private boolean coords = true;
        private boolean cps = true;
        private boolean keystrokes = true;
        private boolean ping = true;
        private boolean armor = true;
        private boolean toggleSprint = false;
        private boolean zoom = true;
        private double zoomFactor = 4.0;
        private String textColor = "#FFFFFF";

        private void validate() {
            zoomFactor = Math.max(1.5, Math.min(10.0, zoomFactor));
            if (textColor == null || !textColor.matches("#[0-9a-fA-F]{6}")) textColor = "#FFFFFF";
        }
    }
}
