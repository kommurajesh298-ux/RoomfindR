type CleanupAction = {
    label: string;
    run: () => Promise<void> | void;
};

export class CleanupRegistry {
    private readonly actions: CleanupAction[] = [];

    add(label: string, run: () => Promise<void> | void) {
        this.actions.push({ label, run });
    }

    async runAll() {
        const errors: string[] = [];

        while (this.actions.length > 0) {
            const action = this.actions.pop();
            if (!action) {
                continue;
            }

            try {
                await action.run();
            } catch (error) {
                errors.push(`${action.label}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (errors.length > 0) {
            throw new Error(`Cleanup registry failed:\n${errors.join('\n')}`);
        }
    }
}
