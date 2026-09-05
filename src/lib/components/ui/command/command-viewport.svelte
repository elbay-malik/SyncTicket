<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';

	let { ref = $bindable(null), ...restProps }: CommandPrimitive.ViewportProps = $props();
</script>

<CommandPrimitive.Viewport bind:ref data-slot="command-viewport" {...restProps} />
