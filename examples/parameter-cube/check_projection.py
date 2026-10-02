import hashlib
import torch
from projection import Projection, MODEL, REVISION

engine = Projection()
query = engine.query
captured = {}
handle = query.register_forward_hook(lambda module, args, output: captured.update(x=args[0], q=output))
first = engine.compute('our home')
handle.remove()
assert first['tokens'] == ['[CLS]', 'our', 'home', '[SEP]']
assert first['model'] == MODEL and first['revision'] == REVISION
assert first['parameters']['shape'] == [256, 64, 4]
assert first['parameters']['visible_shape'] == [4, 4, 4]
with torch.inference_mode():
    expected = captured['x'] @ query.weight.T + query.bias
    error = (captured['q'] - expected).abs().max().item()
    # Float32 fused linear and separate matmul/add can differ by a few ULPs.
    torch.testing.assert_close(captured['q'], expected, rtol=1e-5, atol=3e-6)
    expected_fragment = query.weight.reshape(4, 64, 256).transpose(1, 2)[:, :4, :4]
    assert torch.equal(torch.tensor(first['parameters']['values']), expected_fragment)
    expected_q = captured['q'][0].reshape(4, 4, 64).permute(1, 0, 2)[:, :, :4]
    assert torch.equal(torch.tensor(first['queries']), expected_q)
    assert torch.equal(torch.tensor(first['inputs']), captured['x'][0, :, :4])
second = engine.compute('time flies like arrows')
third = engine.compute('your home')
assert first['parameters'] == second['parameters'] == third['parameters']
assert first['queries'] != third['queries'] and first['inputs'] != third['inputs']
assert len(second['inputs']) == 6 and len(second['queries']) == 4
assert len(second['queries'][0]) == 6
assert first['queries'] == engine.compute('our home')['queries']
after = hashlib.sha256(query.weight.detach().numpy().tobytes()+query.bias.detach().numpy().tobytes()).hexdigest()
assert after == first['parameters']['sha256']
for text in ['', 'word ' * 30]:
    try:
        engine.compute(text)
        raise AssertionError('invalid text accepted')
    except ValueError:
        pass
print(f'PASS: full x @ W.T + bias matches captured Q, max error={error:.2g}.')
print('PASS: correct 4 x 4 fragment per head; text changes X/Q but neither parameters nor their shape/hash.')
