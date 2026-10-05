package dev.changestack.intellij;

import com.intellij.openapi.vcs.changes.actions.SetChangesGroupingAction;
import org.jetbrains.annotations.NotNull;

public final class SemanticGroupingAction extends SetChangesGroupingAction {
    @Override public @NotNull String getGroupingKey() { return "cstack.semantic"; }
}
