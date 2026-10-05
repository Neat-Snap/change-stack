package dev.changestack.intellij;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The import contract contains metadata and explanations, never patches or tokens. */
public record ReviewSnapshot(String title, String url, String headSha, String sourceBranch, String targetBranch,
                             String exportedAt, boolean demo, String summary, String source,
                             List<FileEntry> files, List<Layer> layers, List<Group> groups, List<String> warnings) {
    public record FileEntry(String path, String oldPath) {}
    public record Part(String title, String summary) {}
    public record Annotation(String path, String side, int start, int end, String title, String summary, String partId) {}
    public record Layer(String id, String title, String summary, String category, List<String> files,
                        List<String> dependsOn, List<Part> parts, List<Annotation> annotations) {}
    public record Group(String id, String title, List<String> layers) {}
    public record LayerKey(int rank, String id, String label) {}
    public record GroupKey(int rank, String id, String label) {}

    public static ReviewSnapshot parse(String text) {
        if (text.length() > 16 * 1024 * 1024) throw new IllegalArgumentException("Analysis file is too large (maximum 16 MB).");
        JsonObject root;
        try { root = JsonParser.parseString(text).getAsJsonObject(); }
        catch (RuntimeException error) { throw new IllegalArgumentException("Choose a valid Change Stack analysis JSON file."); }
        if (!"change-stack-intellij".equals(string(root, "format", true)) || !root.has("version")
                || !"1".equals(root.get("version").toString())) {
            throw new IllegalArgumentException("Unsupported analysis format. Export with cstack --export-ide.");
        }
        JsonObject review = object(root, "review"), analysis = object(root, "analysis");
        String url = string(review, "url", true);
        try {
            URI uri = URI.create(url);
            if (!Set.of("https", "http").contains(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) throw new IllegalArgumentException();
        } catch (RuntimeException error) { throw new IllegalArgumentException("Analysis has an invalid review URL."); }
        List<FileEntry> files = new ArrayList<>();
        Set<String> paths = new HashSet<>();
        for (JsonElement item : array(root, "files", true, 10_000)) {
            JsonObject file = item.getAsJsonObject();
            String path = relativePath(string(file, "path", true));
            String old = string(file, "oldPath", false);
            if (!paths.add(path)) throw new IllegalArgumentException("Analysis contains duplicate file paths.");
            files.add(new FileEntry(path, old.isEmpty() ? path : relativePath(old)));
        }
        List<Layer> layers = new ArrayList<>();
        Set<String> layerIds = new HashSet<>();
        for (JsonElement item : array(analysis, "layers", true, 2_000)) {
            JsonObject layer = item.getAsJsonObject();
            String id = string(layer, "id", true);
            if (!layerIds.add(id)) throw new IllegalArgumentException("Analysis contains duplicate layer IDs.");
            List<String> members = strings(layer, "files", true, 10_000);
            if (members.stream().anyMatch(path -> !paths.contains(path))) throw new IllegalArgumentException("A layer refers to a file outside the review snapshot.");
            List<Part> parts = new ArrayList<>();
            for (JsonElement part : array(layer, "parts", false, 100)) {
                JsonObject value = part.getAsJsonObject();
                parts.add(new Part(string(value, "title", true), string(value, "summary", false)));
            }
            List<Annotation> annotations = new ArrayList<>();
            for (JsonElement itemRange : array(layer, "annotations", false, 20_000)) {
                JsonObject value = itemRange.getAsJsonObject();
                String path = string(value, "path", true), side = string(value, "side", true);
                int start = value.get("start").getAsInt(), end = value.get("end").getAsInt();
                if (!members.contains(path) || !Set.of("old", "current").contains(side) || start < 1 || end < start || end > 10_000_000) throw new IllegalArgumentException("Invalid semantic source annotation.");
                annotations.add(new Annotation(path, side, start, end, string(value, "title", true), string(value, "summary", false), string(value, "partId", false)));
            }
            layers.add(new Layer(id, string(layer, "title", true), string(layer, "summary", false),
                    string(layer, "category", false), List.copyOf(members), strings(layer, "dependsOn", false, 2_000), List.copyOf(parts), List.copyOf(annotations)));
        }
        for (Layer layer : layers) if (!layerIds.containsAll(layer.dependsOn())) throw new IllegalArgumentException("A dependency refers to an unknown layer.");
        List<Group> groups = new ArrayList<>();
        Set<String> grouped = new HashSet<>(), groupIds = new HashSet<>();
        for (JsonElement item : array(analysis, "groups", false, 2_000)) {
            JsonObject group = item.getAsJsonObject();
            String id = string(group, "id", true);
            List<String> members = strings(group, "layers", true, 2_000);
            if (!groupIds.add(id) || !layerIds.containsAll(members) || members.stream().anyMatch(member -> !grouped.add(member))) {
                throw new IllegalArgumentException("Analysis contains invalid or overlapping groups.");
            }
            groups.add(new Group(id, string(group, "title", true), members));
        }
        return new ReviewSnapshot(string(review, "title", true), url, string(review, "headSha", true),
                string(review, "sourceBranch", false), string(review, "targetBranch", false), string(root, "exportedAt", true),
                root.has("demo") && root.get("demo").getAsBoolean(), string(analysis, "summary", false), string(analysis, "source", true),
                List.copyOf(files), List.copyOf(layers), List.copyOf(groups), strings(analysis, "warnings", false, 2_000));
    }

    /** File nodes occur once in native trees; repeated memberships stay visible in the panel. */
    public Map<String, LayerKey> primaryLayers() {
        Map<String, LayerKey> result = new LinkedHashMap<>();
        for (int i = 0; i < layers.size(); i++) {
            Layer layer = layers.get(i);
            LayerKey key = new LayerKey(i, layer.id, String.format("%02d · %s", i + 1, layer.title));
            for (String path : layer.files) result.putIfAbsent(path, key);
        }
        LayerKey other = new LayerKey(Integer.MAX_VALUE, "cstack.unassigned", "Other reviewed files");
        for (FileEntry file : files) result.putIfAbsent(file.path, other);
        // Exact current paths take precedence over rename aliases.
        for (FileEntry file : files) result.putIfAbsent(file.oldPath, result.get(file.path));
        return Map.copyOf(result);
    }

    public Map<String, GroupKey> layerGroups() {
        Map<String, GroupKey> result = new LinkedHashMap<>();
        for (int i = 0; i < groups.size(); i++) {
            Group group = groups.get(i);
            GroupKey key = new GroupKey(i, group.id(), group.title());
            for (String layer : group.layers()) result.put(layer, key);
        }
        return Map.copyOf(result);
    }

    static String relativePath(String path) {
        if (path.isBlank() || path.startsWith("/") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0 || path.matches("^[A-Za-z]:.*")) {
            throw new IllegalArgumentException("Analysis paths must be relative to the repository root.");
        }
        for (String part : path.split("/", -1)) if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new IllegalArgumentException("Analysis contains an invalid file path.");
        return path;
    }

    private static JsonObject object(JsonObject parent, String name) {
        if (!parent.has(name) || !parent.get(name).isJsonObject()) throw new IllegalArgumentException("Missing " + name + " in analysis.");
        return parent.getAsJsonObject(name);
    }

    private static String string(JsonObject parent, String name, boolean required) {
        JsonElement value = parent.get(name);
        if (value == null || value.isJsonNull()) {
            if (required) throw new IllegalArgumentException("Missing " + name + " in analysis.");
            return "";
        }
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException("Invalid " + name + " in analysis.");
        String text = value.getAsString();
        if (text.length() > 200_000 || (required && text.isBlank())) throw new IllegalArgumentException("Invalid " + name + " in analysis.");
        return text;
    }

    private static JsonArray array(JsonObject parent, String name, boolean required, int maximum) {
        JsonElement value = parent.get(name);
        if (value == null || value.isJsonNull()) {
            if (required) throw new IllegalArgumentException("Missing " + name + " in analysis.");
            return new JsonArray();
        }
        if (!value.isJsonArray() || value.getAsJsonArray().size() > maximum) throw new IllegalArgumentException("Invalid " + name + " in analysis.");
        return value.getAsJsonArray();
    }

    private static List<String> strings(JsonObject parent, String name, boolean required, int maximum) {
        List<String> result = new ArrayList<>();
        for (JsonElement item : array(parent, name, required, maximum)) {
            if (!item.isJsonPrimitive() || !item.getAsJsonPrimitive().isString() || item.getAsString().length() > 200_000) throw new IllegalArgumentException("Invalid " + name + " in analysis.");
            result.add(item.getAsString());
        }
        return List.copyOf(result);
    }
}
