"""Meridional field of a finite solenoid, approximated by circular turns.

Biot–Savart quadrature omits the common mu0*I/(4*pi) scale, which does not
affect streamlines. Coordinates are radius and axial distance down the page.
"""
import numpy as np


class SolenoidField:
    def __init__(self, radius, top, bottom, turns, segments=192):
        self.radius = radius
        self.middle = (top + bottom) / 2
        self.centres = top + (np.arange(turns) + .5) * (bottom - top) / turns
        self.sines = np.sin((np.arange(segments) + .5) * 2 * np.pi / segments)
        self.dphi = 2 * np.pi / segments

    def vector(self, point):
        radial, axial = point
        dy = axial - self.centres[:, None]
        r = self.radius
        distance2 = radial**2 + r*r - 2*r*radial*self.sines + dy*dy
        weight = self.dphi / distance2**1.5
        return np.array([np.sum(r*self.sines*dy*weight),
                         np.sum(r*(r-radial*self.sines)*weight)])

    def line(self, seed_radius, radial_limit, axial_limit, step=1.2):
        """Trace B without warping; stop at the window or complete a closed loop."""
        point = np.array([seed_radius, self.middle], dtype=float)
        points = [point.copy()]

        def tangent(p):
            field = self.vector(p)
            return field / np.linalg.norm(field)

        for _ in range(6000):
            a = tangent(point)
            b = tangent(point + step*a/2)
            c = tangent(point + step*b/2)
            d = tangent(point + step*c)
            following = point + step*(a + 2*b + 2*c + d)/6
            if point[1] > self.middle and following[1] <= self.middle:
                fraction = (point[1] - self.middle) / (point[1] - following[1])
                points.append(point + fraction*(following - point))
                lower = np.array(points)
                upper = lower[-2::-1] * [1, -1] + [0, 2*self.middle]
                return np.vstack((lower, upper))
            if following[0] >= radial_limit or following[1] >= axial_limit:
                fractions = [(limit-point[axis]) / (following[axis]-point[axis])
                             for axis, limit in ((0, radial_limit), (1, axial_limit))
                             if following[axis] >= limit]
                points.append(point + min(fractions)*(following-point))
                lower = np.array(points)
                upper = lower[:0:-1] * [1, -1] + [0, 2*self.middle]
                return np.vstack((upper, lower))
            points.append(following)
            point = following
        raise ValueError(f"Field line at radius {seed_radius} did not reach the window")
